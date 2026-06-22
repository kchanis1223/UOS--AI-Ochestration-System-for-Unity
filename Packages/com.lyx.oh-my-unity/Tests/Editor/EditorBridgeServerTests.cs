using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Lyx.OhMyUnity.Editor;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace Lyx.OhMyUnity.Tests
{
    /// <summary>
    /// Headed integration tests that drive the LIVE <see cref="EditorBridgeServer"/> listener with
    /// a real <see cref="ClientWebSocket"/>. Complements the UOS client-side bridge protocol tests:
    /// the Bun tests fake the Unity server, these tests fake the UOS client. Together they pin both
    /// halves of the same wire protocol.
    ///
    /// These run inside the Editor TestRunner, so the MainThreadDispatcher pump on
    /// EditorApplication.update drains while we await; no deadlock.
    /// </summary>
    [TestFixture]
    public sealed class EditorBridgeServerTests
    {
        private const int TimeoutMs = 5000;
        private bool _originalAutoStart;

        [OneTimeSetUp]
        public void OneTimeSetUp()
        {
            _originalAutoStart = BridgeSettings.AutoStart;
            BridgeSettings.AutoStart = true;
            if (!EditorBridgeServer.IsRunning)
            {
                EditorBridgeServer.Start();
            }
        }

        [OneTimeTearDown]
        public void OneTimeTearDown()
        {
            BridgeSettings.AutoStart = _originalAutoStart;
            if (!_originalAutoStart)
            {
                EditorBridgeServer.Stop();
            }
        }

        [Test]
        public async Task Bridge_OrPeerEditor_IsListening_OnPort()
        {
            // In a clean Editor process, [InitializeOnLoad] runs Start() and IsRunning is true.
            // In batch test runs co-located with a live Editor instance, Start() loses the bind
            // race (AddressInUse) and IsRunning is false, but the peer Editor *is* serving the
            // same port. Either way, "the configured port has a listener" is the property we care
            // about, so we verify it directly with a handshake.
            Assert.Greater(EditorBridgeServer.Port, 0);
            Assert.IsFalse(string.IsNullOrEmpty(EditorBridgeServer.Host));

            if (EditorBridgeServer.IsRunning) return;

            using var cts = new CancellationTokenSource(TimeoutMs);
            using ClientWebSocket ws = await HandshakeOk(cts.Token);
            Assert.AreEqual(WebSocketState.Open, ws.State);
        }

        [Test]
        public async Task Hello_With_Matching_Major_Receives_Welcome()
        {
            using var cts = new CancellationTokenSource(TimeoutMs);
            using var ws = await ConnectAndHello("1.0.0", BridgeSettings.Token, cts.Token);
            string reply = await ReceiveText(ws, cts.Token);
            StringAssert.Contains("\"kind\":\"welcome\"", reply);
            StringAssert.Contains("1.0.0", reply);
            await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", cts.Token);
        }

        [Test]
        public async Task Hello_With_Wrong_Token_Is_Rejected()
        {
            // Skip when the listener is configured token-less; the auth check is conditional.
            if (string.IsNullOrEmpty(BridgeSettings.Token)) Assert.Ignore("listener has no token configured");

            using var cts = new CancellationTokenSource(TimeoutMs);
            using var ws = await ConnectAndHello("1.0.0", "definitely-not-the-token", cts.Token);
            string reply = await ReceiveText(ws, cts.Token);
            StringAssert.Contains("\"kind\":\"reject\"", reply);
            StringAssert.Contains("invalid token", reply);
        }

        [Test]
        public async Task Hello_With_Major_Mismatch_Is_Rejected()
        {
            using var cts = new CancellationTokenSource(TimeoutMs);
            using var ws = await ConnectAndHello("2.0.0", BridgeSettings.Token, cts.Token);
            string reply = await ReceiveText(ws, cts.Token);
            StringAssert.Contains("\"kind\":\"reject\"", reply);
            StringAssert.Contains("protocol version mismatch", reply);
        }

        [Test]
        public async Task Ping_Receives_Pong()
        {
            using var cts = new CancellationTokenSource(TimeoutMs);
            using var ws = await HandshakeOk(cts.Token);
            await SendText(ws, "{\"kind\":\"ping\"}", cts.Token);
            string reply = await ReceiveText(ws, cts.Token);
            StringAssert.Contains("\"kind\":\"pong\"", reply);
        }

        [Test]
        public async Task ProjectInfo_Includes_Uos_Bridge_Metadata()
        {
            using var cts = new CancellationTokenSource(TimeoutMs);
            using var ws = await HandshakeOk(cts.Token);
            await SendText(ws, "{\"kind\":\"call\",\"id\":21,\"tool\":\"get_project_info\"}", cts.Token);
            string reply = await ReceiveText(ws, cts.Token);
            StringAssert.Contains("\"id\":21", reply);
            StringAssert.Contains("\"ok\":true", reply);
            StringAssert.Contains("\"projectPath\"", reply);
            StringAssert.Contains("\"projectName\"", reply);
            StringAssert.Contains("\"unityVersion\"", reply);
            StringAssert.Contains("\"uosPackageName\":\"com.lyx.oh-my-unity\"", reply);
            StringAssert.Contains("\"protocolVersion\":\"1.0.0\"", reply);
            StringAssert.Contains("\"bridgeHost\"", reply);
            StringAssert.Contains("\"bridgePort\"", reply);
            StringAssert.Contains("\"autoStartBridge\"", reply);
            StringAssert.Contains("\"editorInstanceId\"", reply);
            StringAssert.Contains("\"supportedTools\"", reply);
            StringAssert.Contains("\"get_project_info\"", reply);
            StringAssert.Contains("\"create_ui_screen\"", reply);
            StringAssert.Contains("\"writeTools\"", reply);
            StringAssert.Contains("\"save_scene\"", reply);
        }

        [Test]
        public async Task ListScreens_RoundTrips_OkResult()
        {
            using var cts = new CancellationTokenSource(TimeoutMs);
            using var ws = await HandshakeOk(cts.Token);
            await SendText(ws, "{\"kind\":\"call\",\"id\":42,\"tool\":\"list_screens\"}", cts.Token);
            string reply = await ReceiveText(ws, cts.Token);
            StringAssert.Contains("\"kind\":\"result\"", reply);
            StringAssert.Contains("\"id\":42", reply);
            StringAssert.Contains("\"ok\":true", reply);
            StringAssert.Contains("\"screens\"", reply);
        }

        [Test]
        public async Task ListScreens_Includes_Screen_Id_And_Name()
        {
            Scene previous = EditorSceneManager.GetActiveScene();
            string previousPath = previous.path;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                using var cts = new CancellationTokenSource(TimeoutMs);
                using var ws = await HandshakeOk(cts.Token);
                string create = "{\"kind\":\"call\",\"id\":50,\"tool\":\"create_ui_screen\",\"args\":{\"intent\":{" +
                    "\"version\":\"1.0.0\",\"screenName\":\"NamedListScreen\"," +
                    "\"referenceCanvas\":{\"width\":1920,\"height\":1080}," +
                    "\"elements\":[]}}}";
                await SendText(ws, create, cts.Token);
                string created = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"ok\":true", created);
                string screenId = ExtractJsonString(created, "screenId");
                Assert.IsFalse(string.IsNullOrEmpty(screenId));

                await SendText(ws, "{\"kind\":\"call\",\"id\":51,\"tool\":\"list_screens\"}", cts.Token);
                string listed = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":51", listed);
                StringAssert.Contains("\"ok\":true", listed);
                StringAssert.Contains("\"screenIds\"", listed);
                StringAssert.Contains(screenId, listed);
                StringAssert.Contains("\"id\":\"" + screenId + "\"", listed);
                StringAssert.Contains("\"name\":\"NamedListScreen\"", listed);
            }
            finally
            {
                if (!string.IsNullOrEmpty(previousPath))
                {
                    EditorSceneManager.OpenScene(previousPath, OpenSceneMode.Single);
                }
                else
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
            }
        }

        [Test]
        public async Task UnknownTool_Returns_Error_Result()
        {
            using var cts = new CancellationTokenSource(TimeoutMs);
            using var ws = await HandshakeOk(cts.Token);
            await SendText(ws, "{\"kind\":\"call\",\"id\":7,\"tool\":\"definitely_not_a_tool\"}", cts.Token);
            string reply = await ReceiveText(ws, cts.Token);
            StringAssert.Contains("\"id\":7", reply);
            StringAssert.Contains("\"ok\":false", reply);
            StringAssert.Contains("not implemented", reply);
        }

        [Test]
        public async Task SceneHierarchy_Includes_Element_Details()
        {
            Scene previous = EditorSceneManager.GetActiveScene();
            string previousPath = previous.path;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                using var cts = new CancellationTokenSource(TimeoutMs);
                using var ws = await HandshakeOk(cts.Token);
                string create = "{\"kind\":\"call\",\"id\":70,\"tool\":\"create_ui_screen\",\"args\":{\"intent\":{" +
                    "\"version\":\"1.0.0\",\"screenName\":\"HierarchyDetailSmoke\"," +
                    "\"referenceCanvas\":{\"width\":1920,\"height\":1080}," +
                    "\"elements\":[{" +
                    "\"clientHintId\":\"title\",\"type\":\"Text\"," +
                    "\"rect\":{\"x\":0.1,\"y\":0.2,\"w\":0.8,\"h\":0.1}," +
                    "\"props\":{\"text\":\"Hierarchy Title\",\"fontSize\":44,\"fontStyle\":\"Bold\",\"color\":\"#112233\",\"align\":\"MiddleCenter\"}" +
                    "}]}}}";
                await SendText(ws, create, cts.Token);
                string created = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"ok\":true", created);
                string screenId = ExtractJsonString(created, "screenId");
                Assert.IsFalse(string.IsNullOrEmpty(screenId));

                await SendText(
                    ws,
                    "{\"kind\":\"call\",\"id\":71,\"tool\":\"get_scene_hierarchy\",\"args\":{\"screenId\":\"" +
                    screenId +
                    "\"}}",
                    cts.Token);
                string reply = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":71", reply);
                StringAssert.Contains("\"ok\":true", reply);
                StringAssert.Contains("\"type\":\"Screen\"", reply);
                StringAssert.Contains("\"type\":\"Text\"", reply);
                StringAssert.Contains("\"rootScreenId\":\"" + screenId + "\"", reply);
                StringAssert.Contains("\"rootScreenName\":\"HierarchyDetailSmoke\"", reply);
                StringAssert.Contains("\"rect\":", reply);
                StringAssert.Contains("\"props\":", reply);
                StringAssert.Contains("\"text\":\"Hierarchy Title\"", reply);
                StringAssert.Contains("\"fontSize\":44", reply);
                StringAssert.Contains("\"fontStyle\":\"Bold\"", reply);
                StringAssert.Contains("\"color\":\"#112233FF\"", reply);
            }
            finally
            {
                if (!string.IsNullOrEmpty(previousPath))
                {
                    EditorSceneManager.OpenScene(previousPath, OpenSceneMode.Single);
                }
                else
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
            }
        }

        [Test]
        public async Task SceneHierarchy_Includes_Common_Control_Props()
        {
            Scene previous = EditorSceneManager.GetActiveScene();
            string previousPath = previous.path;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                using var cts = new CancellationTokenSource(TimeoutMs);
                using var ws = await HandshakeOk(cts.Token);
                string create = "{\"kind\":\"call\",\"id\":75,\"tool\":\"create_ui_screen\",\"args\":{\"intent\":{" +
                    "\"version\":\"1.0.0\",\"screenName\":\"HierarchyControlProps\"," +
                    "\"referenceCanvas\":{\"width\":1920,\"height\":1080}," +
                    "\"elements\":[{" +
                    "\"clientHintId\":\"toggle\",\"type\":\"Toggle\"," +
                    "\"rect\":{\"x\":0.1,\"y\":0.1,\"w\":0.3,\"h\":0.08}," +
                    "\"props\":{\"text\":\"Remember\",\"fontSize\":18,\"color\":\"#224466\",\"align\":\"MiddleLeft\",\"hasIsOn\":true,\"isOn\":true,\"hasInteractable\":true,\"interactable\":false}" +
                    "},{" +
                    "\"clientHintId\":\"slider\",\"type\":\"Slider\"," +
                    "\"rect\":{\"x\":0.1,\"y\":0.25,\"w\":0.4,\"h\":0.08}," +
                    "\"props\":{\"color\":\"#336699\",\"hasMinValue\":true,\"minValue\":0,\"hasMaxValue\":true,\"maxValue\":10,\"hasValue\":true,\"value\":7.5}" +
                    "},{" +
                    "\"clientHintId\":\"dropdown\",\"type\":\"Dropdown\"," +
                    "\"rect\":{\"x\":0.1,\"y\":0.4,\"w\":0.4,\"h\":0.08}," +
                    "\"props\":{\"text\":\"Choose\",\"fontSize\":20,\"color\":\"#556677\",\"align\":\"MiddleLeft\",\"options\":[\"Easy\",\"Normal\",\"Hard\"],\"hasValue\":true,\"value\":2}" +
                    "}]}}}";
                await SendText(ws, create, cts.Token);
                string created = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"ok\":true", created);
                string screenId = ExtractJsonString(created, "screenId");
                Assert.IsFalse(string.IsNullOrEmpty(screenId));

                await SendText(
                    ws,
                    "{\"kind\":\"call\",\"id\":76,\"tool\":\"get_scene_hierarchy\",\"args\":{\"screenId\":\"" +
                    screenId +
                    "\"}}",
                    cts.Token);
                string reply = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":76", reply);
                StringAssert.Contains("\"ok\":true", reply);
                StringAssert.Contains("\"type\":\"Toggle\"", reply);
                StringAssert.Contains("\"text\":\"Remember\"", reply);
                StringAssert.Contains("\"color\":\"#224466FF\"", reply);
                StringAssert.Contains("\"isOn\":true", reply);
                StringAssert.Contains("\"interactable\":false", reply);
                StringAssert.Contains("\"type\":\"Slider\"", reply);
                StringAssert.Contains("\"color\":\"#336699FF\"", reply);
                StringAssert.Contains("\"value\":7.5", reply);
                StringAssert.Contains("\"type\":\"Dropdown\"", reply);
                StringAssert.Contains("\"text\":\"Hard\"", reply);
                StringAssert.Contains("\"options\":[\"Easy\",\"Normal\",\"Hard\"]", reply);
                StringAssert.Contains("\"color\":\"#556677FF\"", reply);
            }
            finally
            {
                if (!string.IsNullOrEmpty(previousPath))
                {
                    EditorSceneManager.OpenScene(previousPath, OpenSceneMode.Single);
                }
                else
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
            }
        }

        [Test]
        public async Task UpdateElement_PropsOnly_RoundTrips_Without_Rect()
        {
            Scene previous = EditorSceneManager.GetActiveScene();
            string previousPath = previous.path;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                using var cts = new CancellationTokenSource(TimeoutMs);
                using var ws = await HandshakeOk(cts.Token);
                string create = "{\"kind\":\"call\",\"id\":80,\"tool\":\"create_ui_screen\",\"args\":{\"intent\":{" +
                    "\"version\":\"1.0.0\",\"screenName\":\"PropsOnlyUpdateSmoke\"," +
                    "\"referenceCanvas\":{\"width\":1920,\"height\":1080}," +
                    "\"elements\":[{" +
                    "\"clientHintId\":\"title\",\"type\":\"Text\"," +
                    "\"rect\":{\"x\":0.1,\"y\":0.2,\"w\":0.8,\"h\":0.1}," +
                    "\"props\":{\"text\":\"Before\",\"fontSize\":44,\"color\":\"#112233\",\"align\":\"MiddleCenter\"}" +
                    "}]}}}";
                await SendText(ws, create, cts.Token);
                string created = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"ok\":true", created);
                string screenId = ExtractJsonString(created, "screenId");
                string elementId = ExtractJsonString(created, "elementId");
                Assert.IsFalse(string.IsNullOrEmpty(screenId));
                Assert.IsFalse(string.IsNullOrEmpty(elementId));

                string update = "{\"kind\":\"call\",\"id\":81,\"tool\":\"update_ui_element\",\"args\":{" +
                    "\"elementId\":\"" + elementId + "\"," +
                    "\"props\":{\"text\":\"After\",\"fontSize\":48,\"fontStyle\":\"Italic\",\"color\":\"#445566\",\"align\":\"MiddleCenter\"}" +
                    "}}";
                await SendText(ws, update, cts.Token);
                string updated = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":81", updated);
                StringAssert.Contains("\"ok\":true", updated);

                await SendText(
                    ws,
                    "{\"kind\":\"call\",\"id\":82,\"tool\":\"get_scene_hierarchy\",\"args\":{\"screenId\":\"" +
                    screenId +
                    "\"}}",
                    cts.Token);
                string hierarchy = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":82", hierarchy);
                StringAssert.Contains("\"ok\":true", hierarchy);
                StringAssert.Contains("\"text\":\"After\"", hierarchy);
                StringAssert.Contains("\"fontSize\":48", hierarchy);
                StringAssert.Contains("\"fontStyle\":\"Italic\"", hierarchy);
                StringAssert.Contains("\"color\":\"#445566FF\"", hierarchy);
            }
            finally
            {
                if (!string.IsNullOrEmpty(previousPath))
                {
                    EditorSceneManager.OpenScene(previousPath, OpenSceneMode.Single);
                }
                else
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
            }
        }

        [Test]
        public async Task SetActiveScreen_RoundTrips_And_ListScreens_Keeps_Inactive_Screens()
        {
            Scene previous = EditorSceneManager.GetActiveScene();
            string previousPath = previous.path;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                using var cts = new CancellationTokenSource(TimeoutMs);
                using var ws = await HandshakeOk(cts.Token);
                string createFirst = "{\"kind\":\"call\",\"id\":90,\"tool\":\"create_ui_screen\",\"args\":{\"intent\":{" +
                    "\"version\":\"1.0.0\",\"screenName\":\"FirstScreen\"," +
                    "\"referenceCanvas\":{\"width\":1920,\"height\":1080}," +
                    "\"elements\":[]}}}";
                string createSecond = "{\"kind\":\"call\",\"id\":91,\"tool\":\"create_ui_screen\",\"args\":{\"intent\":{" +
                    "\"version\":\"1.0.0\",\"screenName\":\"SecondScreen\"," +
                    "\"referenceCanvas\":{\"width\":1920,\"height\":1080}," +
                    "\"elements\":[]}}}";
                await SendText(ws, createFirst, cts.Token);
                string firstCreated = await ReceiveText(ws, cts.Token);
                await SendText(ws, createSecond, cts.Token);
                string secondCreated = await ReceiveText(ws, cts.Token);
                string firstScreenId = ExtractJsonString(firstCreated, "screenId");
                string secondScreenId = ExtractJsonString(secondCreated, "screenId");
                Assert.IsFalse(string.IsNullOrEmpty(firstScreenId));
                Assert.IsFalse(string.IsNullOrEmpty(secondScreenId));

                await SendText(
                    ws,
                    "{\"kind\":\"call\",\"id\":92,\"tool\":\"set_active_screen\",\"args\":{\"screenId\":\"" +
                    secondScreenId +
                    "\"}}",
                    cts.Token);
                string activated = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":92", activated);
                StringAssert.Contains("\"ok\":true", activated);
                StringAssert.Contains("\"screenId\":\"" + secondScreenId + "\"", activated);
                StringAssert.Contains("\"active\":true", activated);

                await SendText(ws, "{\"kind\":\"call\",\"id\":93,\"tool\":\"list_screens\"}", cts.Token);
                string listed = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":93", listed);
                StringAssert.Contains("\"ok\":true", listed);
                StringAssert.Contains("\"activeScreenId\":\"" + secondScreenId + "\"", listed);
                StringAssert.Contains("\"id\":\"" + firstScreenId + "\"", listed);
                StringAssert.Contains("\"id\":\"" + secondScreenId + "\"", listed);
                StringAssert.Contains("\"active\":true", listed);

                await SendText(
                    ws,
                    "{\"kind\":\"call\",\"id\":94,\"tool\":\"get_scene_hierarchy\",\"args\":{\"screenId\":\"" +
                    firstScreenId +
                    "\"}}",
                    cts.Token);
                string hierarchy = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":94", hierarchy);
                StringAssert.Contains("\"ok\":true", hierarchy);
                StringAssert.Contains("\"rootScreenId\":\"" + firstScreenId + "\"", hierarchy);
                StringAssert.Contains("\"active\":false", hierarchy);
            }
            finally
            {
                if (!string.IsNullOrEmpty(previousPath))
                {
                    EditorSceneManager.OpenScene(previousPath, OpenSceneMode.Single);
                }
                else
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
            }
        }

        [Test]
        public async Task SaveScene_RoundTrips_And_Writes_Asset()
        {
            const string scenePath = "Assets/__UOSTest/BridgeSaveSceneTest.unity";
            AssetDatabase.DeleteAsset(scenePath);
            AssetDatabase.DeleteAsset("Assets/__UOSTest");

            Scene previous = EditorSceneManager.GetActiveScene();
            string previousPath = previous.path;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                using var cts = new CancellationTokenSource(TimeoutMs);
                using var ws = await HandshakeOk(cts.Token);
                await SendText(
                    ws,
                    "{\"kind\":\"call\",\"id\":99,\"tool\":\"save_scene\",\"args\":{\"path\":\"" + scenePath + "\"}}",
                    cts.Token);
                string reply = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":99", reply);
                StringAssert.Contains("\"ok\":true", reply);
                StringAssert.Contains(scenePath, reply);
                string projectRoot = System.IO.Directory.GetParent(UnityEngine.Application.dataPath).FullName;
                string absoluteScenePath = System.IO.Path.Combine(
                    projectRoot,
                    scenePath.Replace('/', System.IO.Path.DirectorySeparatorChar));
                Assert.IsTrue(System.IO.File.Exists(absoluteScenePath));
            }
            finally
            {
                AssetDatabase.DeleteAsset(scenePath);
                AssetDatabase.DeleteAsset("Assets/__UOSTest");
                if (!string.IsNullOrEmpty(previousPath))
                {
                    EditorSceneManager.OpenScene(previousPath, OpenSceneMode.Single);
                }
                else
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
            }
        }

        [Test]
        public async Task ImportAsset_RoundTrips_Copies_Png_As_Sprite()
        {
            const string assetPath = "Assets/__UOSTest/ImportedSprite.png";
            string sourcePath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "uos-import-asset-test.png");
            AssetDatabase.DeleteAsset(assetPath);
            AssetDatabase.DeleteAsset("Assets/__UOSTest");

            try
            {
                System.IO.File.WriteAllBytes(sourcePath, OnePixelPng());
                string sourceJson = sourcePath.Replace('\\', '/');

                using var cts = new CancellationTokenSource(TimeoutMs);
                using var ws = await HandshakeOk(cts.Token);
                await SendText(
                    ws,
                    "{\"kind\":\"call\",\"id\":101,\"tool\":\"import_asset\",\"args\":{\"sourcePath\":\"" +
                    sourceJson +
                    "\",\"assetPath\":\"" +
                    assetPath +
                    "\",\"importAsSprite\":true}}",
                    cts.Token);
                string reply = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":101", reply);
                StringAssert.Contains("\"ok\":true", reply);
                StringAssert.Contains(assetPath, reply);
                StringAssert.Contains("\"importedAsSprite\":true", reply);

                string projectRoot = System.IO.Directory.GetParent(Application.dataPath).FullName;
                string absoluteAssetPath = System.IO.Path.Combine(
                    projectRoot,
                    assetPath.Replace('/', System.IO.Path.DirectorySeparatorChar));
                Assert.IsTrue(System.IO.File.Exists(absoluteAssetPath));
                Assert.IsNotNull(AssetDatabase.LoadAssetAtPath<Sprite>(assetPath));
            }
            finally
            {
                if (System.IO.File.Exists(sourcePath)) System.IO.File.Delete(sourcePath);
                AssetDatabase.DeleteAsset(assetPath);
                AssetDatabase.DeleteAsset("Assets/__UOSTest");
            }
        }

        [Test]
        public async Task SceneObjectTools_CreateListUpdateDelete_RoundTrip()
        {
            Scene previous = EditorSceneManager.GetActiveScene();
            string previousPath = previous.path;
            try
            {
                EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

                using var cts = new CancellationTokenSource(TimeoutMs);
                using var ws = await HandshakeOk(cts.Token);
                string create = "{\"kind\":\"call\",\"id\":110,\"tool\":\"create_scene_object\",\"args\":{" +
                    "\"name\":\"Conversation Cube\"," +
                    "\"type\":\"Cube\"," +
                    "\"transform\":{" +
                    "\"position\":{\"x\":1,\"y\":2,\"z\":3}," +
                    "\"rotation\":{\"x\":0,\"y\":45,\"z\":0}," +
                    "\"scale\":{\"x\":2,\"y\":2,\"z\":2}" +
                    "}}}";
                await SendText(ws, create, cts.Token);
                string created = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":110", created);
                StringAssert.Contains("\"ok\":true", created);
                StringAssert.Contains("\"name\":\"Conversation Cube\"", created);
                StringAssert.Contains("\"type\":\"Cube\"", created);
                string objectId = ExtractJsonString(created, "objectId");
                Assert.IsFalse(string.IsNullOrEmpty(objectId));

                await SendText(ws, "{\"kind\":\"call\",\"id\":111,\"tool\":\"list_scene_objects\"}", cts.Token);
                string listed = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":111", listed);
                StringAssert.Contains("\"ok\":true", listed);
                StringAssert.Contains(objectId, listed);
                StringAssert.Contains("\"position\":{\"x\":1.0,\"y\":2.0,\"z\":3.0}", listed);

                string update = "{\"kind\":\"call\",\"id\":112,\"tool\":\"update_scene_object\",\"args\":{" +
                    "\"objectId\":\"" + objectId + "\"," +
                    "\"name\":\"Moved Cube\"," +
                    "\"active\":false," +
                    "\"transform\":{" +
                    "\"position\":{\"x\":-1,\"y\":0,\"z\":2}," +
                    "\"rotation\":{\"x\":0,\"y\":90,\"z\":0}," +
                    "\"scale\":{\"x\":1,\"y\":1,\"z\":1}" +
                    "}}}";
                await SendText(ws, update, cts.Token);
                string updated = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":112", updated);
                StringAssert.Contains("\"ok\":true", updated);
                StringAssert.Contains("\"name\":\"Moved Cube\"", updated);
                StringAssert.Contains("\"active\":false", updated);
                StringAssert.Contains("\"position\":{\"x\":-1.0,\"y\":0.0,\"z\":2.0}", updated);

                await SendText(
                    ws,
                    "{\"kind\":\"call\",\"id\":113,\"tool\":\"delete_scene_object\",\"args\":{\"objectId\":\"" +
                    objectId +
                    "\"}}",
                    cts.Token);
                string deleted = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":113", deleted);
                StringAssert.Contains("\"ok\":true", deleted);

                await SendText(ws, "{\"kind\":\"call\",\"id\":114,\"tool\":\"list_scene_objects\"}", cts.Token);
                string afterDelete = await ReceiveText(ws, cts.Token);
                StringAssert.Contains("\"id\":114", afterDelete);
                StringAssert.Contains("\"ok\":true", afterDelete);
                Assert.IsFalse(afterDelete.Contains(objectId));
            }
            finally
            {
                if (!string.IsNullOrEmpty(previousPath))
                {
                    EditorSceneManager.OpenScene(previousPath, OpenSceneMode.Single);
                }
                else
                {
                    EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
                }
            }
        }

        // --- helpers ---------------------------------------------------------

        private static async Task<ClientWebSocket> ConnectAndHello(string version, string token, CancellationToken ct)
        {
            var ws = new ClientWebSocket();
            try
            {
                await ws.ConnectAsync(new Uri($"ws://{EditorBridgeServer.Host}:{EditorBridgeServer.Port}"), ct);
                await SendText(ws, $"{{\"kind\":\"hello\",\"v\":\"{version}\",\"token\":\"{token}\"}}", ct);
                return ws;
            }
            catch
            {
                ws.Dispose();
                throw;
            }
        }

        private static async Task<ClientWebSocket> HandshakeOk(CancellationToken ct)
        {
            ClientWebSocket ws = await ConnectAndHello("1.0.0", BridgeSettings.Token, ct);
            string welcome = await ReceiveText(ws, ct);
            if (!welcome.Contains("\"kind\":\"welcome\""))
            {
                ws.Dispose();
                throw new InvalidOperationException($"handshake did not yield welcome: {welcome}");
            }
            return ws;
        }

        private static async Task SendText(ClientWebSocket ws, string text, CancellationToken ct)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            await ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, ct);
        }

        private static async Task<string> ReceiveText(ClientWebSocket ws, CancellationToken ct)
        {
            var buf = new byte[8192];
            var sb = new StringBuilder();
            while (true)
            {
                WebSocketReceiveResult r = await ws.ReceiveAsync(new ArraySegment<byte>(buf), ct);
                if (r.MessageType == WebSocketMessageType.Close)
                {
                    return sb.ToString();
                }
                sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
                if (r.EndOfMessage) return sb.ToString();
            }
        }

        private static byte[] OnePixelPng()
        {
            var tex = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            try
            {
                tex.SetPixels(new[] { Color.red, Color.green, Color.blue, Color.white });
                tex.Apply();
                return tex.EncodeToPNG();
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(tex);
            }
        }

        private static string ExtractJsonString(string json, string key)
        {
            string marker = "\"" + key + "\":\"";
            int start = json.IndexOf(marker, StringComparison.Ordinal);
            if (start < 0) return null;
            start += marker.Length;
            int end = json.IndexOf('"', start);
            return end < 0 ? null : json.Substring(start, end - start);
        }
    }
}
