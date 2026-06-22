using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.Video;
using UnityEngine.UI;

namespace Lyx.OhMyUnity.Editor
{
    /// <summary>
    /// The Unity-side endpoint of the UOS bridge (decision A1). A background <see cref="TcpListener"/>
    /// accepts localhost WebSocket connections from local UOS clients; each connection runs the
    /// shared-token + version handshake (risk R8), then proxies tool calls. Scene mutation is marshalled
    /// onto the main thread via <see cref="MainThreadDispatcher"/> and wrapped in an <see cref="UndoScope"/>
    /// (AC-4), and a single-writer lock rejects overlapping writes with a busy error (AC-6).
    ///
    /// [InitializeOnLoad] starts the listener after domain reload when Auto Start is enabled (risk R2);
    /// the listener is stopped before assembly reload / on quit so the port is released cleanly.
    ///
    /// The socket lifecycle is the human-verified boundary (cannot run headless); the protocol it speaks
    /// is pinned by the unit-tested UOS client protocol module.
    /// </summary>
    [InitializeOnLoad]
    public static class EditorBridgeServer
    {
        private static readonly object WriteLock = new object();
        private static readonly object ClientsLock = new object();
        private static readonly List<TcpClient> Clients = new List<TcpClient>();
        private static readonly UguiBackend Backend = new UguiBackend();
        private const int MaxHierarchyDepth = 6;
        private static readonly string[] SupportedTools =
        {
            "get_project_info",
            "list_screens",
            "get_scene_hierarchy",
            "capture_preview",
            "list_scene_objects",
            "create_ui_screen",
            "add_ui_element",
            "update_ui_element",
            "move_ui_element",
            "delete_ui_element",
            "create_screen_transition",
            "set_active_screen",
            "save_scene",
            "import_asset",
            "create_scene_object",
            "update_scene_object",
            "delete_scene_object",
        };
        private static readonly HashSet<string> WriteTools = new HashSet<string>
        {
            "create_ui_screen",
            "add_ui_element",
            "update_ui_element",
            "move_ui_element",
            "delete_ui_element",
            "create_screen_transition",
            "set_active_screen",
            "save_scene",
            "import_asset",
            "create_scene_object",
            "update_scene_object",
            "delete_scene_object",
        };

        private static TcpListener _listener;
        private static Thread _acceptThread;
        private static volatile bool _running;

        private static string _expectedToken = string.Empty;
        private static string _host = BridgeSettings.DefaultHost;
        private static int _port = BridgeSettings.DefaultPort;

        static EditorBridgeServer()
        {
            AssemblyReloadEvents.beforeAssemblyReload += Stop;
            EditorApplication.quitting += Stop;
            if (BridgeSettings.AutoStart)
            {
                Start();
            }
        }

        public static bool IsRunning => _running;
        public static int Port => _port;
        public static string Host => _host;

        public static int ConnectedClients
        {
            get { lock (ClientsLock) { return Clients.Count; } }
        }

        public static void Start()
        {
            if (_running) return;

            // Snapshot EditorPrefs-backed settings on the main thread; socket threads use the snapshot.
            _host = BridgeSettings.Host;
            _port = BridgeSettings.Port;
            _expectedToken = BridgeSettings.Token;

            try
            {
                _listener = CreateListener(_host, _port, out int actualPort);
                _port = actualPort;
                _running = true;
                _acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "OhMyUnity-Accept" };
                _acceptThread.Start();
                EditorBridgeRegistry.Publish(_host, _port, _expectedToken);
                Debug.Log($"[OhMyUnity] bridge listening on ws://{_host}:{_port}");
            }
            catch (Exception ex)
            {
                _running = false;
                _listener = null;
                Debug.LogError($"[OhMyUnity] failed to start bridge on {_host}:{_port}: {ex.Message}");
            }
        }

        public static void Stop()
        {
            _running = false;
            EditorBridgeRegistry.Remove();
            try { _listener?.Stop(); } catch { /* best effort */ }
            _listener = null;

            lock (ClientsLock)
            {
                foreach (TcpClient client in Clients)
                {
                    try { client.Close(); } catch { /* best effort */ }
                }
                Clients.Clear();
            }
            // Handler/accept threads are background + observe _running; they exit on their own.
            // We deliberately do not Join() here to avoid stalling the domain-reload pipeline.
        }

        private static TcpListener CreateListener(string host, int requestedPort, out int actualPort)
        {
            IPAddress address = IPAddress.Parse(host);
            try
            {
                var listener = new TcpListener(address, requestedPort);
                listener.Start();
                actualPort = ((IPEndPoint)listener.LocalEndpoint).Port;
                return listener;
            }
            catch (SocketException ex) when (requestedPort != 0)
            {
                Debug.LogWarning(
                    $"[OhMyUnity] port {requestedPort} unavailable ({ex.Message}); using an ephemeral port");
                var listener = new TcpListener(address, 0);
                listener.Start();
                actualPort = ((IPEndPoint)listener.LocalEndpoint).Port;
                return listener;
            }
        }

        public static void Restart()
        {
            Stop();
            Start();
        }

        private static void AcceptLoop()
        {
            while (_running)
            {
                TcpClient client;
                try
                {
                    client = _listener.AcceptTcpClient();
                }
                catch
                {
                    break; // listener stopped/disposed
                }

                lock (ClientsLock) { Clients.Add(client); }
                var handler = new Thread(() => HandleClient(client))
                {
                    IsBackground = true,
                    Name = "OhMyUnity-Client",
                };
                handler.Start();
            }
        }

        private static void HandleClient(TcpClient client)
        {
            WebSocketConnection conn = null;
            try
            {
                conn = WebSocketConnection.Accept(client);
                if (conn == null) return;

                string helloRaw = conn.ReadMessage();
                if (helloRaw == null || !TryHandshake(conn, helloRaw)) return;

                while (_running)
                {
                    string raw = conn.ReadMessage();
                    if (raw == null) break;
                    HandleMessage(conn, raw);
                }
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[OhMyUnity] client handler ended: {ex.Message}");
            }
            finally
            {
                conn?.Dispose();
                lock (ClientsLock) { Clients.Remove(client); }
            }
        }

        private static bool TryHandshake(WebSocketConnection conn, string raw)
        {
            HelloEnvelope hello;
            try { hello = JsonUtility.FromJson<HelloEnvelope>(raw); }
            catch { hello = null; }

            if (hello == null || hello.kind != "hello")
            {
                conn.SendText(Reject("expected hello"));
                return false;
            }
            if (MajorOf(hello.v) != MajorOf(BridgeSettings.ProtocolVersion))
            {
                conn.SendText(Reject($"protocol version mismatch: Unity {BridgeSettings.ProtocolVersion} vs client {hello.v}"));
                return false;
            }
            if (!string.IsNullOrEmpty(_expectedToken) && hello.token != _expectedToken)
            {
                conn.SendText(Reject("invalid token"));
                return false;
            }

            conn.SendText("{\"kind\":\"welcome\",\"v\":\"" + BridgeSettings.ProtocolVersion + "\"}");
            return true;
        }

        private static void HandleMessage(WebSocketConnection conn, string raw)
        {
            CallEnvelope env;
            try { env = JsonUtility.FromJson<CallEnvelope>(raw); }
            catch { env = null; }
            if (env == null) return;

            if (env.kind == "ping")
            {
                conn.SendText("{\"kind\":\"pong\"}");
                return;
            }
            if (env.kind != "call") return;

            bool isWrite = WriteTools.Contains(env.tool);
            if (isWrite && !Monitor.TryEnter(WriteLock))
            {
                MainThreadDispatcher.Enqueue(() =>
                    ToolCallLog.Record(env.tool, ToolCallStatus.Failed, "busy: another write is in progress"));
                conn.SendText(ErrorResult(env.id, "busy: another write is in progress"));
                return;
            }

            try
            {
                string dataJson = MainThreadDispatcher
                    .EnqueueAsync(() => Execute(env.tool, raw))
                    .GetAwaiter()
                    .GetResult();
                conn.SendText(OkResult(env.id, dataJson));
            }
            catch (Exception ex)
            {
                Exception cause = ex.InnerException ?? ex;
                MainThreadDispatcher.Enqueue(() =>
                    ToolCallLog.Record(env.tool, ToolCallStatus.Failed, cause.Message));
                conn.SendText(ErrorResult(env.id, cause.Message));
            }
            finally
            {
                if (isWrite) Monitor.Exit(WriteLock);
            }
        }

        // Runs on the Unity main thread (via MainThreadDispatcher). Returns the `data` JSON payload.
        private static string Execute(string tool, string raw)
        {
            ToolCallLog.Record(tool, ToolCallStatus.Received, tool);
            switch (tool)
            {
                case "create_ui_screen":
                    return ExecuteCreateScreen(raw);
                case "add_ui_element":
                    return ExecuteAddElement(raw);
                case "update_ui_element":
                case "move_ui_element":
                    return ExecuteUpdateElement(tool, raw);
                case "delete_ui_element":
                    return ExecuteDeleteElement(raw);
                case "create_screen_transition":
                    return ExecuteCreateTransition(raw);
                case "set_active_screen":
                    return ExecuteSetActiveScreen(raw);
                case "list_screens":
                    return ExecuteListScreens(tool);
                case "get_scene_hierarchy":
                    return ExecuteSceneHierarchy(tool, raw);
                case "capture_preview":
                    return ExecuteCapturePreview(raw);
                case "get_project_info":
                    return ExecuteProjectInfo(tool);
                case "save_scene":
                    return ExecuteSaveScene(tool, raw);
                case "import_asset":
                    return ExecuteImportAsset(tool, raw);
                case "create_scene_object":
                    return ExecuteCreateSceneObject(raw);
                case "update_scene_object":
                    return ExecuteUpdateSceneObject(raw);
                case "delete_scene_object":
                    return ExecuteDeleteSceneObject(raw);
                case "list_scene_objects":
                    return ExecuteListSceneObjects(tool);
                default:
                    throw new NotSupportedException(
                        $"tool '{tool}' is not implemented in the v1 Editor backbone");
            }
        }

        private static string ExecuteCreateScreen(string raw)
        {
            var call = JsonUtility.FromJson<CreateScreenCall>(raw);
            if (call?.args?.intent == null) throw new ArgumentException("create_ui_screen: missing intent");

            using var undo = new UndoScope("MCP Create Screen");
            CreateScreenResult result = Backend.CreateScreen(call.args.intent, undo);
            undo.Commit();

            var data = new CreateScreenData
            {
                screenId = result.ScreenId,
                elements = result.Elements
                    .Select(p => new ElementPairData { clientHintId = p.ClientHintId, elementId = p.ElementId })
                    .ToArray(),
            };
            ToolCallLog.Record("create_ui_screen", ToolCallStatus.Succeeded, result.ScreenId);
            return JsonUtility.ToJson(data);
        }

        private static string ExecuteAddElement(string raw)
        {
            var call = JsonUtility.FromJson<AddElementCall>(raw);
            if (call?.args?.element == null) throw new ArgumentException("add_ui_element: missing element");

            using var undo = new UndoScope("MCP Add Element");
            string elementId = Backend.AddElement(call.args.screenId, call.args.element, undo);
            if (elementId == null) throw new InvalidOperationException($"screen '{call.args.screenId}' not found");
            undo.Commit();

            ToolCallLog.Record("add_ui_element", ToolCallStatus.Succeeded, elementId);
            return JsonUtility.ToJson(new ElementIdData { elementId = elementId });
        }

        private static string ExecuteUpdateElement(string tool, string raw)
        {
            var call = JsonUtility.FromJson<UpdateElementCall>(raw);
            UpdateElementArgs args = call?.args;
            if (args == null || string.IsNullOrEmpty(args.elementId))
                throw new ArgumentException($"{tool}: missing elementId");

            bool hasRect = HasJsonProperty(raw, "rect");
            bool hasProps = HasJsonProperty(raw, "props");
            bool hasAnchor = HasJsonProperty(raw, "anchor") && !string.IsNullOrEmpty(args.anchor);
            NormRectData rect = hasRect ? args.rect : null;
            ElementProps props = hasProps ? args.props : null;
            if (rect == null && props == null && !hasAnchor)
                throw new ArgumentException($"{tool}: requires rect, anchor, and/or props");
            if (rect != null && (rect.w <= 0f || rect.h <= 0f))
                throw new ArgumentException($"{tool}: rect requires w,h > 0");

            using var undo = new UndoScope("MCP Update Element");
            bool ok = Backend.UpdateElement(args.elementId, rect, args.anchor, props, undo);
            if (!ok) throw new InvalidOperationException($"element '{args.elementId}' not found");
            undo.Commit();

            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, args.elementId);
            return JsonUtility.ToJson(new OkData { ok = true });
        }

        private static string ExecuteDeleteElement(string raw)
        {
            var call = JsonUtility.FromJson<DeleteElementCall>(raw);
            string elementId = call?.args?.elementId;
            if (string.IsNullOrEmpty(elementId)) throw new ArgumentException("delete_ui_element: missing elementId");

            using var undo = new UndoScope("MCP Delete Element");
            bool ok = Backend.DeleteElement(elementId, undo);
            if (!ok) throw new InvalidOperationException($"element '{elementId}' not found");
            undo.Commit();

            ToolCallLog.Record("delete_ui_element", ToolCallStatus.Succeeded, elementId);
            return JsonUtility.ToJson(new OkData { ok = true });
        }

        private static string ExecuteCreateTransition(string raw)
        {
            var call = JsonUtility.FromJson<TransitionCall>(raw);
            TransitionArgs args = call?.args;
            if (args == null || string.IsNullOrEmpty(args.fromId) || string.IsNullOrEmpty(args.toId))
                throw new ArgumentException("create_screen_transition: requires fromId and toId");

            ScreenFlowController controller = UnityEngine.Object.FindFirstObjectByType<ScreenFlowController>();
            if (controller == null)
                throw new InvalidOperationException("no ScreenFlowController in scene; create a screen first");

            using var undo = new UndoScope("MCP Create Transition");
            undo.RecordObject(controller, "Add Transition");
            controller.AddTransition(new ScreenTransition
            {
                fromScreenId = args.fromId,
                toScreenId = args.toId,
                trigger = args.trigger,
            });
            undo.Commit();

            ToolCallLog.Record("create_screen_transition", ToolCallStatus.Succeeded, $"{args.fromId} -> {args.toId}");
            return JsonUtility.ToJson(new OkData { ok = true });
        }

        private static string ExecuteSetActiveScreen(string raw)
        {
            var call = JsonUtility.FromJson<SetActiveScreenCall>(raw);
            string screenId = call?.args?.screenId;
            if (string.IsNullOrEmpty(screenId))
                throw new ArgumentException("set_active_screen: missing screenId");

            using var undo = new UndoScope("MCP Set Active Screen");
            bool ok = Backend.SetActiveScreen(screenId, undo);
            if (!ok) throw new InvalidOperationException($"screen '{screenId}' not found");
            undo.Commit();

            GameObject go = FindGameObjectById(screenId);
            ToolCallLog.Record("set_active_screen", ToolCallStatus.Succeeded, screenId);
            return JsonUtility.ToJson(new ActiveScreenData
            {
                ok = true,
                screenId = screenId,
                name = go != null ? go.name : string.Empty,
                active = go != null && go.activeSelf,
            });
        }

        private static string ExecuteListScreens(string tool)
        {
            string[] ids = Backend.ListScreens().ToArray();
            ScreenFlowController controller = UnityEngine.Object.FindFirstObjectByType<ScreenFlowController>();
            string activeScreenId = controller != null ? controller.ActiveScreenId : string.Empty;
            ScreenListItemData[] screens = ids.Select(id =>
            {
                GameObject go = FindGameObjectById(id);
                return new ScreenListItemData
                {
                    id = id,
                    name = go != null ? go.name : string.Empty,
                    active = (!string.IsNullOrEmpty(activeScreenId) && activeScreenId == id)
                        || (string.IsNullOrEmpty(activeScreenId) && go != null && go.activeSelf),
                };
            }).ToArray();
            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, $"{ids.Length} screen(s)");
            return JsonUtility.ToJson(new ScreenListData
            {
                screenIds = ids,
                screens = screens,
                activeScreenId = activeScreenId,
            });
        }

        // Identity of the project this Editor has open. Application.dataPath is
        // "<project>/Assets"; the project root is its parent. Lets the UOS
        // launcher/plugin write work context into "<projectRoot>/.uos".
        private static string ExecuteProjectInfo(string tool)
        {
            ProjectInfoData data = BridgeProjectInfo.Create(
                _host,
                _port,
                supportedTools: SupportedTools,
                writeTools: WriteTools.OrderBy(name => name).ToArray());
            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, data.projectPath);
            return JsonUtility.ToJson(data);
        }

        private static string ExecuteSaveScene(string tool, string raw)
        {
            var call = JsonUtility.FromJson<SaveSceneCall>(raw);
            string requestedPath = call?.args?.path;
            Scene scene = EditorSceneManager.GetActiveScene();
            if (!scene.IsValid())
                throw new InvalidOperationException("save_scene: active scene is not valid");

            string savePath = ResolveSceneSavePath(requestedPath, scene.path);
            if (!savePath.EndsWith(".unity", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("save_scene: path must end with .unity");

            EnsureSceneDirectory(savePath);
            bool ok = EditorSceneManager.SaveScene(scene, savePath);
            if (!ok) throw new InvalidOperationException($"save_scene: failed to save active scene to '{savePath}'");
            AssetDatabase.Refresh();

            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, savePath);
            return JsonUtility.ToJson(new SaveSceneData
            {
                ok = true,
                path = savePath,
                sceneName = scene.name,
            });
        }

        private static string ExecuteImportAsset(string tool, string raw)
        {
            var call = JsonUtility.FromJson<ImportAssetCall>(raw);
            ImportAssetArgs args = call?.args;
            if (args == null || string.IsNullOrWhiteSpace(args.sourcePath))
                throw new ArgumentException("import_asset: missing sourcePath");

            string sourcePath = args.sourcePath.Trim();
            if (!System.IO.File.Exists(sourcePath))
                throw new System.IO.FileNotFoundException("import_asset: source file not found", sourcePath);

            string assetPath = ResolveImportAssetPath(sourcePath, args.assetPath);
            EnsureAssetDirectory(assetPath);

            string destinationAbsolute = AbsoluteProjectPath(assetPath);
            string sourceAbsolute = System.IO.Path.GetFullPath(sourcePath);
            if (!PathsEqual(sourceAbsolute, destinationAbsolute))
            {
                System.IO.File.Copy(sourceAbsolute, destinationAbsolute, true);
            }

            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceUpdate);
            bool importedAsSprite = false;
            if (args.importAsSprite && IsSupportedSpriteExtension(assetPath))
            {
                var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter;
                if (importer != null)
                {
                    importer.textureType = TextureImporterType.Sprite;
                    importer.spriteImportMode = SpriteImportMode.Single;
                    importer.mipmapEnabled = false;
                    importer.SaveAndReimport();
                    importedAsSprite = AssetDatabase.LoadAssetAtPath<Sprite>(assetPath) != null;
                }
            }

            UnityEngine.Object imported = AssetDatabase.LoadMainAssetAtPath(assetPath);
            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, assetPath);
            return JsonUtility.ToJson(new ImportAssetData
            {
                ok = true,
                sourcePath = sourceAbsolute,
                assetPath = assetPath,
                importedAsSprite = importedAsSprite,
                assetType = imported != null ? imported.GetType().Name : string.Empty,
            });
        }

        private static string ExecuteCreateSceneObject(string raw)
        {
            var call = JsonUtility.FromJson<CreateSceneObjectCall>(raw);
            CreateSceneObjectArgs args = call?.args ?? new CreateSceneObjectArgs();
            string type = NormalizeSceneObjectType(args.type);
            string name = string.IsNullOrWhiteSpace(args.name) ? DefaultSceneObjectName(type) : args.name.Trim();

            using var undo = new UndoScope("MCP Create Scene Object");
            GameObject go = CreateSceneObject(type, name);
            undo.RegisterCreated(go);

            var marker = go.AddComponent<SceneObjectId>();
            string objectId = "SceneObject_" + Guid.NewGuid().ToString("N").Substring(0, 12);
            marker.Assign(objectId, type);

            if (HasJsonProperty(raw, "parentId"))
            {
                SetSceneObjectParent(go, args.parentId, undo);
            }
            ApplySceneTransform(
                go,
                args.transform,
                undo,
                createDefaults: true,
                hasPosition: true,
                hasRotation: true,
                hasScale: true);

            bool active = HasJsonProperty(raw, "active") ? args.active : true;
            go.SetActive(active);
            EditorSceneManager.MarkSceneDirty(go.scene);
            undo.Commit();

            ToolCallLog.Record("create_scene_object", ToolCallStatus.Succeeded, objectId);
            return JsonUtility.ToJson(SceneObjectData.From(go, objectId));
        }

        private static string ExecuteUpdateSceneObject(string raw)
        {
            var call = JsonUtility.FromJson<UpdateSceneObjectCall>(raw);
            UpdateSceneObjectArgs args = call?.args;
            if (args == null || string.IsNullOrWhiteSpace(args.objectId))
                throw new ArgumentException("update_scene_object: missing objectId");

            bool hasName = HasJsonProperty(raw, "name");
            bool hasParent = HasJsonProperty(raw, "parentId");
            bool hasActive = HasJsonProperty(raw, "active");
            bool hasPosition = HasJsonProperty(raw, "position");
            bool hasRotation = HasJsonProperty(raw, "rotation");
            bool hasScale = HasJsonProperty(raw, "scale");
            if (!hasName && !hasParent && !hasActive && !hasPosition && !hasRotation && !hasScale)
                throw new ArgumentException("update_scene_object: requires name, parentId, active, position, rotation, or scale");

            GameObject go = FindSceneObjectById(args.objectId.Trim());
            if (go == null) throw new InvalidOperationException($"scene object '{args.objectId}' not found");

            using var undo = new UndoScope("MCP Update Scene Object");
            if (hasName)
            {
                undo.RecordObject(go, "Update Scene Object Name");
                go.name = string.IsNullOrWhiteSpace(args.name) ? go.name : args.name.Trim();
            }
            if (hasParent)
            {
                SetSceneObjectParent(go, args.parentId, undo);
            }
            if (hasPosition || hasRotation || hasScale)
            {
                ApplySceneTransform(
                    go,
                    args.transform,
                    undo,
                    createDefaults: false,
                    hasPosition: hasPosition,
                    hasRotation: hasRotation,
                    hasScale: hasScale);
            }
            if (hasActive)
            {
                undo.RecordObject(go, "Update Scene Object Active");
                go.SetActive(args.active);
            }
            EditorSceneManager.MarkSceneDirty(go.scene);
            undo.Commit();

            ToolCallLog.Record("update_scene_object", ToolCallStatus.Succeeded, args.objectId);
            return JsonUtility.ToJson(SceneObjectData.From(go, args.objectId.Trim()));
        }

        private static string ExecuteDeleteSceneObject(string raw)
        {
            var call = JsonUtility.FromJson<DeleteSceneObjectCall>(raw);
            string objectId = call?.args?.objectId;
            if (string.IsNullOrWhiteSpace(objectId))
                throw new ArgumentException("delete_scene_object: missing objectId");

            GameObject go = FindSceneObjectById(objectId.Trim());
            if (go == null) throw new InvalidOperationException($"scene object '{objectId}' not found");
            Scene scene = go.scene;

            using var undo = new UndoScope("MCP Delete Scene Object");
            Undo.DestroyObjectImmediate(go);
            EditorSceneManager.MarkSceneDirty(scene);
            undo.Commit();

            ToolCallLog.Record("delete_scene_object", ToolCallStatus.Succeeded, objectId);
            return JsonUtility.ToJson(new OkData { ok = true });
        }

        private static string ExecuteListSceneObjects(string tool)
        {
            SceneObjectData[] objects = UnityEngine.Object.FindObjectsByType<SceneObjectId>(
                    FindObjectsInactive.Include,
                    FindObjectsSortMode.None)
                .Where(marker => marker != null && !string.IsNullOrEmpty(marker.ObjectId))
                .Select(marker => SceneObjectData.From(marker.gameObject, marker.ObjectId))
                .OrderBy(data => data.path)
                .ThenBy(data => data.objectId)
                .ToArray();

            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, $"{objects.Length} scene object(s)");
            return JsonUtility.ToJson(new SceneObjectListData { objects = objects });
        }

        private static GameObject CreateSceneObject(string type, string name)
        {
            switch (type)
            {
                case "Empty":
                    return new GameObject(name);
                case "Cube":
                    return CreatePrimitive(PrimitiveType.Cube, name);
                case "Sphere":
                    return CreatePrimitive(PrimitiveType.Sphere, name);
                case "Capsule":
                    return CreatePrimitive(PrimitiveType.Capsule, name);
                case "Cylinder":
                    return CreatePrimitive(PrimitiveType.Cylinder, name);
                case "Plane":
                    return CreatePrimitive(PrimitiveType.Plane, name);
                case "Quad":
                    return CreatePrimitive(PrimitiveType.Quad, name);
                case "Camera":
                {
                    var go = new GameObject(name);
                    go.AddComponent<Camera>();
                    return go;
                }
                case "DirectionalLight":
                case "PointLight":
                case "SpotLight":
                {
                    var go = new GameObject(name);
                    var light = go.AddComponent<Light>();
                    light.type = type == "DirectionalLight"
                        ? LightType.Directional
                        : type == "SpotLight"
                            ? LightType.Spot
                            : LightType.Point;
                    return go;
                }
                default:
                    throw new ArgumentException($"create_scene_object: unsupported type '{type}'");
            }
        }

        private static GameObject CreatePrimitive(PrimitiveType primitiveType, string name)
        {
            GameObject go = GameObject.CreatePrimitive(primitiveType);
            go.name = name;
            return go;
        }

        private static string NormalizeSceneObjectType(string raw)
        {
            string normalized = (raw ?? string.Empty).Trim().Replace(" ", string.Empty).Replace("-", string.Empty).ToLowerInvariant();
            switch (normalized)
            {
                case "":
                case "empty":
                case "gameobject":
                    return "Empty";
                case "cube":
                    return "Cube";
                case "sphere":
                    return "Sphere";
                case "capsule":
                    return "Capsule";
                case "cylinder":
                    return "Cylinder";
                case "plane":
                    return "Plane";
                case "quad":
                    return "Quad";
                case "camera":
                    return "Camera";
                case "light":
                case "point":
                case "pointlight":
                    return "PointLight";
                case "directional":
                case "directionallight":
                    return "DirectionalLight";
                case "spot":
                case "spotlight":
                    return "SpotLight";
                default:
                    return raw?.Trim() ?? string.Empty;
            }
        }

        private static string DefaultSceneObjectName(string type)
        {
            return string.IsNullOrEmpty(type) ? "UOS Scene Object" : "UOS " + type;
        }

        private static void SetSceneObjectParent(GameObject go, string parentId, UndoScope undo)
        {
            Transform parent = null;
            if (!string.IsNullOrWhiteSpace(parentId))
            {
                GameObject parentGo = FindGeneratedGameObjectById(parentId.Trim());
                if (parentGo == null) throw new InvalidOperationException($"parent object '{parentId}' not found");
                if (parentGo == go) throw new InvalidOperationException("scene object cannot be parented to itself");
                if (parentGo.transform.IsChildOf(go.transform))
                    throw new InvalidOperationException("scene object cannot be parented to one of its descendants");
                parent = parentGo.transform;
            }

            undo.RecordObject(go.transform, "Update Scene Object Parent");
            go.transform.SetParent(parent, false);
        }

        private static void ApplySceneTransform(
            GameObject go,
            SceneTransformData transform,
            UndoScope undo,
            bool createDefaults,
            bool hasPosition,
            bool hasRotation,
            bool hasScale)
        {
            undo.RecordObject(go.transform, "Update Scene Object Transform");
            if (createDefaults || hasPosition)
                go.transform.localPosition = ToVector3(transform?.position, Vector3.zero);
            if (createDefaults || hasRotation)
                go.transform.localEulerAngles = ToVector3(transform?.rotation, Vector3.zero);
            if (createDefaults || hasScale)
                go.transform.localScale = ToVector3(transform?.scale, Vector3.one);
        }

        private static Vector3 ToVector3(Vec3Data data, Vector3 fallback)
        {
            if (data == null) return fallback;
            return new Vector3(data.x, data.y, data.z);
        }

        private static GameObject FindSceneObjectById(string id)
        {
            foreach (SceneObjectId marker in UnityEngine.Object.FindObjectsByType<SceneObjectId>(
                FindObjectsInactive.Include,
                FindObjectsSortMode.None))
            {
                if (marker.ObjectId == id) return marker.gameObject;
            }
            return null;
        }

        private static GameObject FindGeneratedGameObjectById(string id)
        {
            return FindSceneObjectById(id) ?? FindGameObjectById(id);
        }

        private static string InspectSceneObjectType(GameObject go)
        {
            var light = go.GetComponent<Light>();
            if (light != null)
            {
                switch (light.type)
                {
                    case LightType.Directional: return "DirectionalLight";
                    case LightType.Spot: return "SpotLight";
                    default: return "PointLight";
                }
            }
            if (go.GetComponent<Camera>() != null) return "Camera";
            if (go.GetComponent<MeshFilter>() != null || go.GetComponent<MeshRenderer>() != null) return "Mesh";
            return "Empty";
        }

        private static string[] InspectSceneObjectComponents(GameObject go)
        {
            return go.GetComponents<Component>()
                .Where(component => component != null)
                .Select(component => component.GetType().Name)
                .ToArray();
        }

        private static string HierarchyPath(Transform transform)
        {
            var names = new List<string>();
            Transform current = transform;
            while (current != null)
            {
                names.Add(current.name);
                current = current.parent;
            }
            names.Reverse();
            return string.Join("/", names);
        }

        private static string ResolveSceneSavePath(string requestedPath, string currentScenePath)
        {
            string path = string.IsNullOrWhiteSpace(requestedPath)
                ? currentScenePath
                : requestedPath.Trim();
            if (string.IsNullOrWhiteSpace(path))
                path = "Assets/UOS_Generated.unity";

            path = path.Replace('\\', '/');
            if (System.IO.Path.IsPathRooted(path))
            {
                string relative = FileUtil.GetProjectRelativePath(path);
                if (string.IsNullOrEmpty(relative))
                    throw new ArgumentException("save_scene: absolute path must be inside the Unity project");
                path = relative;
            }
            if (!path.StartsWith("Assets/", StringComparison.Ordinal) && path != "Assets")
                path = "Assets/" + path.TrimStart('/');
            return path;
        }

        private static void EnsureSceneDirectory(string assetPath)
        {
            string directory = System.IO.Path.GetDirectoryName(assetPath)?.Replace('\\', '/');
            if (string.IsNullOrEmpty(directory) || directory == "Assets") return;

            string projectRoot = System.IO.Directory.GetParent(Application.dataPath)?.FullName ?? Application.dataPath;
            string absolute = System.IO.Path.Combine(projectRoot, directory.Replace('/', System.IO.Path.DirectorySeparatorChar));
            System.IO.Directory.CreateDirectory(absolute);
        }

        private static string ResolveImportAssetPath(string sourcePath, string requestedAssetPath)
        {
            string path = string.IsNullOrWhiteSpace(requestedAssetPath)
                ? "Assets/UOS/Imported/" + SafeFileName(System.IO.Path.GetFileName(sourcePath))
                : requestedAssetPath.Trim();
            path = path.Replace('\\', '/');

            if (path.EndsWith("/", StringComparison.Ordinal))
            {
                path += SafeFileName(System.IO.Path.GetFileName(sourcePath));
            }

            if (System.IO.Path.IsPathRooted(path))
            {
                string relative = FileUtil.GetProjectRelativePath(path);
                if (string.IsNullOrEmpty(relative))
                    throw new ArgumentException("import_asset: absolute assetPath must be inside the Unity project");
                path = relative;
            }

            if (!path.StartsWith("Assets/", StringComparison.Ordinal) && path != "Assets")
                path = "Assets/" + path.TrimStart('/');
            if (path == "Assets")
                throw new ArgumentException("import_asset: assetPath must name a file under Assets");

            string ext = System.IO.Path.GetExtension(path);
            if (string.IsNullOrEmpty(ext))
                path += System.IO.Path.GetExtension(sourcePath);
            return path;
        }

        private static void EnsureAssetDirectory(string assetPath)
        {
            string directory = System.IO.Path.GetDirectoryName(assetPath)?.Replace('\\', '/');
            if (string.IsNullOrEmpty(directory) || directory == "Assets") return;
            System.IO.Directory.CreateDirectory(AbsoluteProjectPath(directory));
        }

        private static string AbsoluteProjectPath(string assetPath)
        {
            string projectRoot = System.IO.Directory.GetParent(Application.dataPath)?.FullName ?? Application.dataPath;
            return System.IO.Path.Combine(projectRoot, assetPath.Replace('/', System.IO.Path.DirectorySeparatorChar));
        }

        private static bool PathsEqual(string a, string b)
        {
            return string.Equals(
                System.IO.Path.GetFullPath(a).TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar),
                System.IO.Path.GetFullPath(b).TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
        }

        private static string SafeFileName(string fileName)
        {
            if (string.IsNullOrEmpty(fileName)) return "asset";
            foreach (char c in System.IO.Path.GetInvalidFileNameChars())
            {
                fileName = fileName.Replace(c, '_');
            }
            return fileName;
        }

        private static bool IsSupportedSpriteExtension(string assetPath)
        {
            string ext = System.IO.Path.GetExtension(assetPath).ToLowerInvariant();
            switch (ext)
            {
                case ".png":
                case ".jpg":
                case ".jpeg":
                case ".tga":
                case ".psd":
                    return true;
                default:
                    return false;
            }
        }

        private static string ExecuteCapturePreview(string raw)
        {
            var call = JsonUtility.FromJson<CapturePreviewCall>(raw);
            string screenId = call?.args?.screenId;
            if (string.IsNullOrEmpty(screenId))
                throw new ArgumentException("capture_preview: missing screenId");

            GameObject go = FindGameObjectById(screenId);
            if (go == null)
                throw new InvalidOperationException($"screen '{screenId}' not found");

            Canvas canvas = go.GetComponent<Canvas>();
            if (canvas == null)
                throw new InvalidOperationException($"screen '{screenId}' has no Canvas");

            var scaler = go.GetComponent<UnityEngine.UI.CanvasScaler>();
            int width = Mathf.Clamp(
                scaler != null ? Mathf.RoundToInt(scaler.referenceResolution.x) : 1024, 32, 2048);
            int height = Mathf.Clamp(
                scaler != null ? Mathf.RoundToInt(scaler.referenceResolution.y) : 1024, 32, 2048);

            byte[] png = RenderCanvasToPng(canvas, width, height);
            ToolCallLog.Record("capture_preview", ToolCallStatus.Succeeded,
                $"{screenId} ({png.Length} bytes)");
            return JsonUtility.ToJson(new CapturePreviewData
            {
                screenId = screenId,
                mimeType = "image/png",
                width = width,
                height = height,
                base64Data = Convert.ToBase64String(png),
                size = png.Length,
            });
        }

        // Render the Canvas to a RenderTexture via a temporary preview camera, then
        // encode the readback as PNG. Mirror caps the dimensions to keep the base64
        // payload bounded (the UOS planning-material read cap is ~2MB).
        private static byte[] RenderCanvasToPng(Canvas canvas, int width, int height)
        {
            RenderMode originalMode = canvas.renderMode;
            Camera originalCam = canvas.worldCamera;

            var camGo = new GameObject("MCP_PreviewCamera") { hideFlags = HideFlags.HideAndDontSave };
            try
            {
                var cam = camGo.AddComponent<Camera>();
                cam.enabled = false;
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0f, 0f, 0f, 0f);
                cam.orthographic = true;
                cam.cullingMask = ~0;

                canvas.renderMode = RenderMode.ScreenSpaceCamera;
                canvas.worldCamera = cam;
                Canvas.ForceUpdateCanvases();

                var rt = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
                rt.Create();
                RenderTexture prev = RenderTexture.active;
                try
                {
                    cam.targetTexture = rt;
                    cam.Render();
                    RenderTexture.active = rt;
                    var tex = new Texture2D(width, height, TextureFormat.RGBA32, false);
                    try
                    {
                        tex.ReadPixels(new Rect(0, 0, width, height), 0, 0);
                        tex.Apply();
                        return tex.EncodeToPNG();
                    }
                    finally
                    {
                        UnityEngine.Object.DestroyImmediate(tex);
                    }
                }
                finally
                {
                    RenderTexture.active = prev;
                    rt.Release();
                    UnityEngine.Object.DestroyImmediate(rt);
                }
            }
            finally
            {
                canvas.renderMode = originalMode;
                canvas.worldCamera = originalCam;
                UnityEngine.Object.DestroyImmediate(camGo);
            }
        }

        private static string ExecuteSceneHierarchy(string tool, string raw)
        {
            var call = JsonUtility.FromJson<HierarchyCall>(raw);
            string screenId = call?.args?.screenId;

            var roots = new List<HierarchyNode>();
            var nodes = new List<HierarchyFlatNode>();
            if (!string.IsNullOrEmpty(screenId))
            {
                GameObject go = FindGameObjectById(screenId);
                if (go == null) throw new InvalidOperationException($"screen '{screenId}' not found");
                roots.Add(BuildHierarchyNode(go.transform, false));
                AppendFlatHierarchy(go.transform, string.Empty, 0, nodes, screenId, go.name);
            }
            else
            {
                foreach (string id in Backend.ListScreens())
                {
                    GameObject go = FindGameObjectById(id);
                    if (go == null) continue;
                    roots.Add(BuildHierarchyNode(go.transform, false));
                    AppendFlatHierarchy(go.transform, string.Empty, 0, nodes, id, go.name);
                }
            }

            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, screenId ?? "scene");
            return JsonUtility.ToJson(new HierarchyData { roots = roots.ToArray(), nodes = nodes.ToArray() });
        }

        private static void AppendFlatHierarchy(
            Transform transform,
            string parentElementId,
            int depth,
            List<HierarchyFlatNode> nodes,
            string rootScreenId,
            string rootScreenName)
        {
            HierarchyNode node = BuildHierarchyNode(transform, depth >= MaxHierarchyDepth && transform.childCount > 0);
            nodes.Add(new HierarchyFlatNode
            {
                name = node.name,
                elementId = node.elementId,
                parentElementId = parentElementId,
                rootScreenId = rootScreenId,
                rootScreenName = rootScreenName,
                depth = depth,
                type = node.type,
                rect = node.rect,
                anchor = node.anchor,
                props = node.props,
                active = node.active,
                childCount = node.childCount,
                truncated = node.truncated,
            });

            if (depth >= MaxHierarchyDepth) return;
            string nextParent = !string.IsNullOrEmpty(node.elementId) ? node.elementId : parentElementId;
            for (int i = 0; i < transform.childCount; i++)
            {
                AppendFlatHierarchy(transform.GetChild(i), nextParent, depth + 1, nodes, rootScreenId, rootScreenName);
            }
        }

        private static HierarchyNode BuildHierarchyNode(Transform transform, bool truncated)
        {
            var marker = transform.GetComponent<ScreenElementId>();
            var props = InspectProps(transform.gameObject);
            return new HierarchyNode
            {
                name = transform.name,
                elementId = marker != null ? marker.ElementId : string.Empty,
                type = InspectElementType(transform.gameObject),
                rect = InspectRect(transform as RectTransform),
                anchor = InspectAnchor(transform as RectTransform),
                props = props,
                active = transform.gameObject.activeSelf,
                childCount = transform.childCount,
                truncated = truncated,
            };
        }

        private static NormRectData InspectRect(RectTransform rt)
        {
            if (rt == null) return null;
            CanvasScaler scaler = rt.GetComponentInParent<CanvasScaler>(true);
            float cw = scaler != null ? scaler.referenceResolution.x : Screen.width;
            float ch = scaler != null ? scaler.referenceResolution.y : Screen.height;
            if (cw <= 0f || ch <= 0f) return null;
            Vector2 anchorRef = new Vector2(rt.anchorMin.x * cw, (1f - rt.anchorMin.y) * ch);
            return new NormRectData
            {
                x = (anchorRef.x + rt.anchoredPosition.x - rt.pivot.x * rt.sizeDelta.x) / cw,
                y = (anchorRef.y - rt.anchoredPosition.y - (1f - rt.pivot.y) * rt.sizeDelta.y) / ch,
                w = rt.sizeDelta.x / cw,
                h = rt.sizeDelta.y / ch,
            };
        }

        private static string InspectAnchor(RectTransform rt)
        {
            if (rt == null) return string.Empty;
            Vector2 anchor = rt.anchorMin;
            if ((rt.anchorMax - anchor).sqrMagnitude > 0.000001f) return "Stretch";
            if (Close(anchor.x, 0f) && Close(anchor.y, 1f)) return "TopLeft";
            if (Close(anchor.x, 0.5f) && Close(anchor.y, 1f)) return "TopCenter";
            if (Close(anchor.x, 1f) && Close(anchor.y, 1f)) return "TopRight";
            if (Close(anchor.x, 0f) && Close(anchor.y, 0.5f)) return "MiddleLeft";
            if (Close(anchor.x, 0.5f) && Close(anchor.y, 0.5f)) return "MiddleCenter";
            if (Close(anchor.x, 1f) && Close(anchor.y, 0.5f)) return "MiddleRight";
            if (Close(anchor.x, 0f) && Close(anchor.y, 0f)) return "BottomLeft";
            if (Close(anchor.x, 0.5f) && Close(anchor.y, 0f)) return "BottomCenter";
            if (Close(anchor.x, 1f) && Close(anchor.y, 0f)) return "BottomRight";
            return $"{anchor.x:0.###},{anchor.y:0.###}";
        }

        private static bool Close(float a, float b)
        {
            return Mathf.Abs(a - b) < 0.0001f;
        }

        private static ElementProps InspectProps(GameObject go)
        {
            string type = InspectElementType(go);
            var props = new ElementProps();
            bool hasProps = false;

            if (type == "Text")
            {
                var text = go.GetComponent<Text>();
                if (text != null)
                {
                    props.text = text.text;
                    props.fontSize = text.fontSize;
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(text.color);
                    props.align = text.alignment.ToString();
                    props.fontStyle = text.fontStyle.ToString();
                    hasProps = true;
                }
            }
            else if (type == "Button")
            {
                var image = go.GetComponent<Image>();
                if (image != null)
                {
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(image.color);
                    props.sprite = image.sprite != null ? AssetDatabase.GetAssetPath(image.sprite) : string.Empty;
                    hasProps = true;
                }
                Transform label = go.transform.Find("Label");
                var labelText = label != null ? label.GetComponent<Text>() : null;
                if (labelText != null)
                {
                    props.text = labelText.text;
                    props.fontSize = labelText.fontSize;
                    props.align = labelText.alignment.ToString();
                    props.fontStyle = labelText.fontStyle.ToString();
                    hasProps = true;
                }
                hasProps |= InspectSelectableProps(go, props);
            }
            else if (type == "Image" || type == "Panel")
            {
                var image = go.GetComponent<Image>();
                if (image != null)
                {
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(image.color);
                    props.sprite = image.sprite != null ? AssetDatabase.GetAssetPath(image.sprite) : string.Empty;
                    hasProps = true;
                }
            }
            else if (type == "InputField")
            {
                var image = go.GetComponent<Image>();
                if (image != null)
                {
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(image.color);
                    hasProps = true;
                }
                var input = go.GetComponent<InputField>();
                var placeholder = input != null ? input.placeholder as Text : null;
                if (placeholder != null)
                {
                    props.text = placeholder.text;
                    props.placeholder = placeholder.text;
                    props.fontSize = placeholder.fontSize;
                    props.align = placeholder.alignment.ToString();
                    props.fontStyle = placeholder.fontStyle.ToString();
                    hasProps = true;
                }
                if (input != null)
                {
                    props.inputText = input.text;
                    hasProps = true;
                }
                hasProps |= InspectSelectableProps(go, props);
            }
            else if (type == "Toggle")
            {
                var toggle = go.GetComponent<Toggle>();
                var image = go.GetComponent<Image>();
                if (image != null)
                {
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(image.color);
                    props.sprite = image.sprite != null ? AssetDatabase.GetAssetPath(image.sprite) : string.Empty;
                    hasProps = true;
                }
                Transform label = go.transform.Find("Label");
                var labelText = label != null ? label.GetComponent<Text>() : null;
                if (labelText != null)
                {
                    props.text = labelText.text;
                    props.fontSize = labelText.fontSize;
                    props.align = labelText.alignment.ToString();
                    props.fontStyle = labelText.fontStyle.ToString();
                    hasProps = true;
                }
                if (toggle != null)
                {
                    props.hasIsOn = true;
                    props.isOn = toggle.isOn;
                    hasProps = true;
                }
                hasProps |= InspectSelectableProps(go, props);
            }
            else if (type == "Slider")
            {
                var image = go.GetComponent<Image>();
                if (image != null)
                {
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(image.color);
                    props.sprite = image.sprite != null ? AssetDatabase.GetAssetPath(image.sprite) : string.Empty;
                    hasProps = true;
                }
                var slider = go.GetComponent<Slider>();
                if (slider != null)
                {
                    props.hasValue = true;
                    props.value = slider.value;
                    props.hasMinValue = true;
                    props.minValue = slider.minValue;
                    props.hasMaxValue = true;
                    props.maxValue = slider.maxValue;
                    hasProps = true;
                }
                hasProps |= InspectSelectableProps(go, props);
            }
            else if (type == "ScrollView")
            {
                var image = go.GetComponent<Image>();
                if (image != null)
                {
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(image.color);
                    props.sprite = image.sprite != null ? AssetDatabase.GetAssetPath(image.sprite) : string.Empty;
                    hasProps = true;
                }
            }
            else if (type == "Dropdown")
            {
                var image = go.GetComponent<Image>();
                if (image != null)
                {
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(image.color);
                    props.sprite = image.sprite != null ? AssetDatabase.GetAssetPath(image.sprite) : string.Empty;
                    hasProps = true;
                }
                var dropdown = go.GetComponent<Dropdown>();
                var caption = dropdown != null ? dropdown.captionText : null;
                if (caption != null)
                {
                    props.text = caption.text;
                    props.fontSize = caption.fontSize;
                    props.align = caption.alignment.ToString();
                    props.fontStyle = caption.fontStyle.ToString();
                    hasProps = true;
                }
                if (dropdown != null)
                {
                    props.hasValue = true;
                    props.value = dropdown.value;
                    props.options = dropdown.options.Select(option => option.text).ToArray();
                    hasProps = true;
                }
                hasProps |= InspectSelectableProps(go, props);
            }
            else if (type == "Video")
            {
                var rawImage = go.GetComponent<RawImage>();
                if (rawImage != null)
                {
                    props.color = "#" + ColorUtility.ToHtmlStringRGBA(rawImage.color);
                    hasProps = true;
                }
                var player = go.GetComponent<VideoPlayer>();
                if (player != null)
                {
                    props.video = player.clip != null ? AssetDatabase.GetAssetPath(player.clip) : string.Empty;
                    props.hasLoop = true;
                    props.loop = player.isLooping;
                    props.hasPlayOnAwake = true;
                    props.playOnAwake = player.playOnAwake;
                    hasProps = true;
                }
                var audio = go.GetComponent<AudioSource>();
                if (audio != null)
                {
                    props.hasMuted = true;
                    props.muted = audio.mute;
                    hasProps = true;
                }
            }

            return hasProps ? props : null;
        }

        private static bool InspectSelectableProps(GameObject go, ElementProps props)
        {
            var selectable = go.GetComponent<Selectable>();
            if (selectable == null) return false;
            props.hasInteractable = true;
            props.interactable = selectable.interactable;
            return true;
        }

        private static string InspectElementType(GameObject go)
        {
            if (go.GetComponent<Canvas>() != null) return "Screen";
            if (go.GetComponent<Button>() != null) return "Button";
            if (go.GetComponent<InputField>() != null) return "InputField";
            if (go.GetComponent<Toggle>() != null) return "Toggle";
            if (go.GetComponent<Slider>() != null) return "Slider";
            if (go.GetComponent<ScrollRect>() != null) return "ScrollView";
            if (go.GetComponent<Dropdown>() != null) return "Dropdown";
            if (go.GetComponent<VideoPlayer>() != null || go.GetComponent<RawImage>() != null) return "Video";
            if (go.GetComponent<Text>() != null) return "Text";
            if (go.GetComponent<Image>() != null) return "Image";
            return string.Empty;
        }

        private static GameObject FindGameObjectById(string id)
        {
            foreach (ScreenElementId marker in UnityEngine.Object.FindObjectsByType<ScreenElementId>(
                FindObjectsInactive.Include,
                FindObjectsSortMode.None))
            {
                if (marker.ElementId == id) return marker.gameObject;
            }
            return null;
        }

        private static string MajorOf(string version)
        {
            if (string.IsNullOrEmpty(version)) return version;
            int dot = version.IndexOf('.');
            return dot < 0 ? version : version.Substring(0, dot);
        }

        private static string OkResult(int id, string dataJson) =>
            "{\"kind\":\"result\",\"id\":" + id + ",\"ok\":true,\"data\":" + dataJson + "}";

        private static string ErrorResult(int id, string error) =>
            "{\"kind\":\"result\",\"id\":" + id + ",\"ok\":false,\"error\":\"" + JsonEscape(error) + "\"}";

        private static string Reject(string reason) =>
            "{\"kind\":\"reject\",\"reason\":\"" + JsonEscape(reason) + "\"}";

        private static string JsonEscape(string s)
        {
            if (string.IsNullOrEmpty(s)) return string.Empty;
            var sb = new System.Text.StringBuilder(s.Length + 8);
            foreach (char c in s)
            {
                switch (c)
                {
                    case '\\': sb.Append("\\\\"); break;
                    case '"': sb.Append("\\\""); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            return sb.ToString();
        }

        private static bool HasJsonProperty(string json, string propertyName)
        {
            if (string.IsNullOrEmpty(json) || string.IsNullOrEmpty(propertyName)) return false;
            string needle = "\"" + propertyName + "\"";
            return json.IndexOf(needle, StringComparison.Ordinal) >= 0;
        }

        // ---- Wire DTOs (JsonUtility round-trips these [Serializable] mirrors of the protocol) ----

        [Serializable] private sealed class HelloEnvelope { public string kind; public string v; public string token; }
        [Serializable] private sealed class CallEnvelope { public string kind; public int id; public string tool; }

        [Serializable] private sealed class CreateScreenArgs { public PlanningIntentData intent; }
        [Serializable] private sealed class CreateScreenCall { public CreateScreenArgs args; }

        [Serializable] private sealed class AddElementArgs { public string screenId; public IntentElementData element; }
        [Serializable] private sealed class AddElementCall { public AddElementArgs args; }

        [Serializable] private sealed class UpdateElementArgs { public string elementId; public NormRectData rect; public string anchor; public ElementProps props; }
        [Serializable] private sealed class UpdateElementCall { public UpdateElementArgs args; }

        [Serializable] private sealed class DeleteElementArgs { public string elementId; }
        [Serializable] private sealed class DeleteElementCall { public DeleteElementArgs args; }

        [Serializable] private sealed class TransitionArgs { public string fromId; public string toId; public string trigger; }
        [Serializable] private sealed class TransitionCall { public TransitionArgs args; }

        [Serializable] private sealed class SetActiveScreenArgs { public string screenId; }
        [Serializable] private sealed class SetActiveScreenCall { public SetActiveScreenArgs args; }
        [Serializable] private sealed class ActiveScreenData { public bool ok; public string screenId; public string name; public bool active; }

        [Serializable] private sealed class HierarchyArgs { public string screenId; }
        [Serializable] private sealed class HierarchyCall { public HierarchyArgs args; }

        [Serializable] private sealed class CapturePreviewArgs { public string screenId; }
        [Serializable] private sealed class CapturePreviewCall { public CapturePreviewArgs args; }
        [Serializable] private sealed class CapturePreviewData
        {
            public string screenId;
            public string mimeType;
            public int width;
            public int height;
            public string base64Data;
            public int size;
        }

        [Serializable] private sealed class SaveSceneArgs { public string path; }
        [Serializable] private sealed class SaveSceneCall { public SaveSceneArgs args; }
        [Serializable] private sealed class SaveSceneData { public bool ok; public string path; public string sceneName; }

        [Serializable] private sealed class ImportAssetArgs { public string sourcePath; public string assetPath; public bool importAsSprite = true; }
        [Serializable] private sealed class ImportAssetCall { public ImportAssetArgs args; }
        [Serializable] private sealed class ImportAssetData
        {
            public bool ok;
            public string sourcePath;
            public string assetPath;
            public bool importedAsSprite;
            public string assetType;
        }

        [Serializable] private sealed class Vec3Data { public float x; public float y; public float z; }
        [Serializable] private sealed class SceneTransformData { public Vec3Data position; public Vec3Data rotation; public Vec3Data scale; }

        [Serializable]
        private sealed class CreateSceneObjectArgs
        {
            public string name;
            public string type;
            public string parentId;
            public bool active;
            public SceneTransformData transform;
        }
        [Serializable] private sealed class CreateSceneObjectCall { public CreateSceneObjectArgs args; }

        [Serializable]
        private sealed class UpdateSceneObjectArgs
        {
            public string objectId;
            public string name;
            public string parentId;
            public bool active;
            public SceneTransformData transform;
        }
        [Serializable] private sealed class UpdateSceneObjectCall { public UpdateSceneObjectArgs args; }

        [Serializable] private sealed class DeleteSceneObjectArgs { public string objectId; }
        [Serializable] private sealed class DeleteSceneObjectCall { public DeleteSceneObjectArgs args; }

        [Serializable]
        private sealed class SceneObjectData
        {
            public string objectId;
            public string name;
            public string type;
            public string path;
            public string parentObjectId;
            public bool active;
            public SceneTransformData transform;
            public string[] components;

            public static SceneObjectData From(GameObject go, string objectId)
            {
                var marker = go.GetComponent<SceneObjectId>();
                var parentMarker = go.transform.parent != null
                    ? go.transform.parent.GetComponent<SceneObjectId>()
                    : null;
                return new SceneObjectData
                {
                    objectId = objectId,
                    name = go.name,
                    type = marker != null && !string.IsNullOrEmpty(marker.ObjectType)
                        ? marker.ObjectType
                        : InspectSceneObjectType(go),
                    path = HierarchyPath(go.transform),
                    parentObjectId = parentMarker != null ? parentMarker.ObjectId : string.Empty,
                    active = go.activeSelf,
                    transform = new SceneTransformData
                    {
                        position = Vec3From(go.transform.localPosition),
                        rotation = Vec3From(go.transform.localEulerAngles),
                        scale = Vec3From(go.transform.localScale),
                    },
                    components = InspectSceneObjectComponents(go),
                };
            }

            private static Vec3Data Vec3From(Vector3 value)
            {
                return new Vec3Data { x = value.x, y = value.y, z = value.z };
            }
        }
        [Serializable] private sealed class SceneObjectListData { public SceneObjectData[] objects; }

        [Serializable] private sealed class ElementPairData { public string clientHintId; public string elementId; }
        [Serializable] private sealed class CreateScreenData { public string screenId; public ElementPairData[] elements; }
        [Serializable] private sealed class ElementIdData { public string elementId; }
        [Serializable] private sealed class ScreenListItemData { public string id; public string name; public bool active; }
        [Serializable] private sealed class ScreenListData { public string[] screenIds; public ScreenListItemData[] screens; public string activeScreenId; }
        [Serializable] private sealed class OkData { public bool ok; }
        [Serializable] private sealed class HierarchyNode
        {
            public string name;
            public string elementId;
            public string type;
            public NormRectData rect;
            public string anchor;
            public ElementProps props;
            public bool active;
            public int childCount;
            public bool truncated;
        }
        [Serializable] private sealed class HierarchyFlatNode
        {
            public string name;
            public string elementId;
            public string parentElementId;
            public string rootScreenId;
            public string rootScreenName;
            public int depth;
            public string type;
            public NormRectData rect;
            public string anchor;
            public ElementProps props;
            public bool active;
            public int childCount;
            public bool truncated;
        }
        [Serializable] private sealed class HierarchyData { public HierarchyNode[] roots; public HierarchyFlatNode[] nodes; }
    }
}
