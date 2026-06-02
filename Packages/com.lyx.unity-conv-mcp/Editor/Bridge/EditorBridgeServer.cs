using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace Lyx.UnityConvMcp.Editor
{
    /// <summary>
    /// The Unity-side endpoint of the sidecar bridge (decision A1). A background <see cref="TcpListener"/>
    /// accepts localhost WebSocket connections from the spawnable Node sidecar; each connection runs the
    /// shared-token + version handshake (risk R8), then proxies tool calls. Scene mutation is marshalled
    /// onto the main thread via <see cref="MainThreadDispatcher"/> and wrapped in an <see cref="UndoScope"/>
    /// (AC-4), and a single-writer lock rejects overlapping writes with a busy error (AC-6).
    ///
    /// [InitializeOnLoad] restarts the listener after every domain reload (risk R2); the listener is
    /// stopped before assembly reload / on quit so the port is released cleanly.
    ///
    /// The socket lifecycle is the human-verified boundary (cannot run headless); the protocol it speaks
    /// is pinned by the unit-tested sidecar protocol module.
    /// </summary>
    [InitializeOnLoad]
    public static class EditorBridgeServer
    {
        private static readonly object WriteLock = new object();
        private static readonly object ClientsLock = new object();
        private static readonly List<TcpClient> Clients = new List<TcpClient>();
        private static readonly UguiBackend Backend = new UguiBackend();
        private static readonly HashSet<string> WriteTools = new HashSet<string>
        {
            "create_ui_screen",
            "add_ui_element",
            "update_ui_element",
            "move_ui_element",
            "delete_ui_element",
            "create_screen_transition",
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
            Start();
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
                _listener = new TcpListener(IPAddress.Parse(_host), _port);
                _listener.Start();
                _running = true;
                _acceptThread = new Thread(AcceptLoop) { IsBackground = true, Name = "UnityConvMcp-Accept" };
                _acceptThread.Start();
                Debug.Log($"[UnityConvMcp] bridge listening on ws://{_host}:{_port}");
            }
            catch (Exception ex)
            {
                _running = false;
                _listener = null;
                Debug.LogError($"[UnityConvMcp] failed to start bridge on {_host}:{_port}: {ex.Message}");
            }
        }

        public static void Stop()
        {
            _running = false;
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
                    Name = "UnityConvMcp-Client",
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
                Debug.LogWarning($"[UnityConvMcp] client handler ended: {ex.Message}");
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
                conn.SendText(Reject($"protocol version mismatch: Unity {BridgeSettings.ProtocolVersion} vs sidecar {hello.v}"));
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
                case "list_screens":
                    return ExecuteListScreens(tool);
                case "get_scene_hierarchy":
                    return ExecuteSceneHierarchy(tool, raw);
                case "capture_preview":
                    return ExecuteCapturePreview(raw);
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
            if (args.rect == null || args.rect.w <= 0f || args.rect.h <= 0f)
                throw new ArgumentException($"{tool}: requires a rect with w,h > 0 (props-only updates are not supported in the v1 backbone)");

            using var undo = new UndoScope("MCP Update Element");
            bool ok = Backend.UpdateElement(args.elementId, args.rect, args.anchor, undo);
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

        private static string ExecuteListScreens(string tool)
        {
            string[] ids = Backend.ListScreens().ToArray();
            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, $"{ids.Length} screen(s)");
            return JsonUtility.ToJson(new ScreenListData { screens = ids });
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
        // payload bounded (the sidecar's planning-material read cap is ~2MB).
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
            if (!string.IsNullOrEmpty(screenId))
            {
                GameObject go = FindGameObjectById(screenId);
                if (go == null) throw new InvalidOperationException($"screen '{screenId}' not found");
                roots.Add(BuildHierarchy(go.transform));
            }
            else
            {
                foreach (string id in Backend.ListScreens())
                {
                    GameObject go = FindGameObjectById(id);
                    if (go != null) roots.Add(BuildHierarchy(go.transform));
                }
            }

            ToolCallLog.Record(tool, ToolCallStatus.Succeeded, screenId ?? "scene");
            return JsonUtility.ToJson(new HierarchyData { roots = roots.ToArray() });
        }

        private static HierarchyNode BuildHierarchy(Transform transform)
        {
            var marker = transform.GetComponent<ScreenElementId>();
            var children = new HierarchyNode[transform.childCount];
            for (int i = 0; i < transform.childCount; i++)
            {
                children[i] = BuildHierarchy(transform.GetChild(i));
            }
            return new HierarchyNode
            {
                name = transform.name,
                elementId = marker != null ? marker.ElementId : string.Empty,
                children = children,
            };
        }

        private static GameObject FindGameObjectById(string id)
        {
            foreach (ScreenElementId marker in UnityEngine.Object.FindObjectsByType<ScreenElementId>(FindObjectsSortMode.None))
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

        // ---- Wire DTOs (JsonUtility round-trips these [Serializable] mirrors of the protocol) ----

        [Serializable] private sealed class HelloEnvelope { public string kind; public string v; public string token; }
        [Serializable] private sealed class CallEnvelope { public string kind; public int id; public string tool; }

        [Serializable] private sealed class CreateScreenArgs { public PlanningIntentData intent; }
        [Serializable] private sealed class CreateScreenCall { public CreateScreenArgs args; }

        [Serializable] private sealed class AddElementArgs { public string screenId; public IntentElementData element; }
        [Serializable] private sealed class AddElementCall { public AddElementArgs args; }

        [Serializable] private sealed class UpdateElementArgs { public string elementId; public NormRectData rect; public string anchor; }
        [Serializable] private sealed class UpdateElementCall { public UpdateElementArgs args; }

        [Serializable] private sealed class DeleteElementArgs { public string elementId; }
        [Serializable] private sealed class DeleteElementCall { public DeleteElementArgs args; }

        [Serializable] private sealed class TransitionArgs { public string fromId; public string toId; public string trigger; }
        [Serializable] private sealed class TransitionCall { public TransitionArgs args; }

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

        [Serializable] private sealed class ElementPairData { public string clientHintId; public string elementId; }
        [Serializable] private sealed class CreateScreenData { public string screenId; public ElementPairData[] elements; }
        [Serializable] private sealed class ElementIdData { public string elementId; }
        [Serializable] private sealed class ScreenListData { public string[] screens; }
        [Serializable] private sealed class OkData { public bool ok; }
        [Serializable] private sealed class HierarchyNode { public string name; public string elementId; public HierarchyNode[] children; }
        [Serializable] private sealed class HierarchyData { public HierarchyNode[] roots; }
    }
}
