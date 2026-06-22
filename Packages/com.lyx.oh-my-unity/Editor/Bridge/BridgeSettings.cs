using System;
using UnityEditor;

namespace Lyx.OhMyUnity.Editor
{
    /// <summary>
    /// Persisted bridge configuration (host/port/shared token) backed by EditorPrefs. The local UOS
    /// launcher injects matching values into opencode (UNITY_MCP_HOST/PORT/TOKEN), and MonitorWindow
    /// shows an explicit-env fallback snippet for manual troubleshooting (decision D1, risk R8).
    ///
    /// EditorPrefs is main-thread only, so <see cref="EditorBridgeServer"/> snapshots these on Start
    /// and the background socket threads compare against the snapshot rather than touching EditorPrefs.
    /// </summary>
    internal static class BridgeSettings
    {
        /// <summary>Sidecar&lt;-&gt;Unity protocol version. Major must match across the handshake.</summary>
        public const string ProtocolVersion = "1.0.0";

        public const string DefaultHost = "127.0.0.1";
        public const int DefaultPort = 17801;

        private const string PortKey = "Lyx.UnityConvMcp.Port";
        private const string HostKey = "Lyx.UnityConvMcp.Host";
        private const string TokenKey = "Lyx.UnityConvMcp.Token";
        private const string AutoStartKey = "Lyx.UnityConvMcp.AutoStart";

        public static bool AutoStart
        {
            get => EditorPrefs.GetBool(AutoStartKey, true);
            set => EditorPrefs.SetBool(AutoStartKey, value);
        }

        public static int Port
        {
            get => EditorPrefs.GetInt(PortKey, DefaultPort);
            set => EditorPrefs.SetInt(PortKey, value);
        }

        public static string Host
        {
            get
            {
                string host = EditorPrefs.GetString(HostKey, DefaultHost);
                return string.IsNullOrEmpty(host) ? DefaultHost : host;
            }
            set => EditorPrefs.SetString(HostKey, value);
        }

        /// <summary>
        /// The shared auth token. Generated lazily on first read so a fresh install is never
        /// token-less; regenerate via <see cref="RegenerateToken"/> to rotate it.
        /// </summary>
        public static string Token
        {
            get
            {
                string token = EditorPrefs.GetString(TokenKey, string.Empty);
                if (string.IsNullOrEmpty(token))
                {
                    token = NewToken();
                    EditorPrefs.SetString(TokenKey, token);
                }
                return token;
            }
        }

        public static string RegenerateToken()
        {
            string token = NewToken();
            EditorPrefs.SetString(TokenKey, token);
            return token;
        }

        private static string NewToken() => Guid.NewGuid().ToString("N");
    }
}
