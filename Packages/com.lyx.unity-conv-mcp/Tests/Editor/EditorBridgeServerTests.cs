using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Lyx.UnityConvMcp.Editor;
using NUnit.Framework;

namespace Lyx.UnityConvMcp.Tests
{
    /// <summary>
    /// Headed integration tests that drive the LIVE <see cref="EditorBridgeServer"/> listener with
    /// a real <see cref="ClientWebSocket"/>. Complements the sidecar-side e2e in
    /// mcp-server/test/bridgeClient.e2e.test.ts: the sidecar tests fake the Unity server, these
    /// tests fake the sidecar client. Together they pin both halves of the same wire protocol.
    ///
    /// These run inside the Editor TestRunner, so the MainThreadDispatcher pump on
    /// EditorApplication.update drains while we await — no deadlock.
    /// </summary>
    [TestFixture]
    public sealed class EditorBridgeServerTests
    {
        private const int TimeoutMs = 5000;

        [Test]
        public async Task Bridge_OrPeerEditor_IsListening_OnPort()
        {
            // In a clean Editor process, [InitializeOnLoad] runs Start() and IsRunning is true.
            // In batch test runs co-located with a live Editor instance, Start() loses the bind
            // race (AddressInUse) and IsRunning is false — but the peer Editor *is* serving the
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
    }
}
