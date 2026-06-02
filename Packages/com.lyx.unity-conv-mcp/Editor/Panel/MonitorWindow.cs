using System;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Lyx.UnityConvMcp.Editor
{
    /// <summary>
    /// Passive monitor/dashboard for the MCP bridge (AC-8: monitor, never a chat surface). Shows the
    /// listener status, the shared token + a copyable client config snippet (so the user can point any
    /// MCP client at this Editor), and a live tool-call log fed by <see cref="ToolCallLog"/>.
    ///
    /// All generation is driven by the external client over the bridge; this window only observes.
    /// </summary>
    public sealed class MonitorWindow : EditorWindow
    {
        private Vector2 _logScroll;
        private Vector2 _snippetScroll;
        private bool _showToken;

        [MenuItem("Window/Lyx Unity Conv MCP/Monitor")]
        public static void Open()
        {
            MonitorWindow window = GetWindow<MonitorWindow>();
            window.titleContent = new GUIContent("Unity Conv MCP");
            window.minSize = new Vector2(360f, 420f);
            window.Show();
        }

        private void OnEnable()
        {
            ToolCallLog.Changed += Repaint;
        }

        private void OnDisable()
        {
            ToolCallLog.Changed -= Repaint;
        }

        private void OnGUI()
        {
            DrawStatus();
            EditorGUILayout.Space();
            DrawConnection();
            EditorGUILayout.Space();
            DrawClientConfig();
            EditorGUILayout.Space();
            DrawLog();
        }

        private void DrawStatus()
        {
            EditorGUILayout.LabelField("Bridge Status", EditorStyles.boldLabel);
            using (new EditorGUILayout.HorizontalScope())
            {
                bool running = EditorBridgeServer.IsRunning;
                string state = running
                    ? $"Listening on ws://{EditorBridgeServer.Host}:{EditorBridgeServer.Port}"
                    : "Stopped";
                EditorGUILayout.LabelField("Server", state);
            }
            EditorGUILayout.LabelField("Connected clients", EditorBridgeServer.ConnectedClients.ToString());

            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button(EditorBridgeServer.IsRunning ? "Restart" : "Start"))
                {
                    EditorBridgeServer.Restart();
                }
                using (new EditorGUI.DisabledScope(!EditorBridgeServer.IsRunning))
                {
                    if (GUILayout.Button("Stop"))
                    {
                        EditorBridgeServer.Stop();
                    }
                }
            }
        }

        private void DrawConnection()
        {
            EditorGUILayout.LabelField("Shared Token", EditorStyles.boldLabel);
            using (new EditorGUILayout.HorizontalScope())
            {
                string token = BridgeSettings.Token;
                string shown = _showToken ? token : new string('*', Math.Min(token.Length, 24));
                EditorGUILayout.SelectableLabel(shown, EditorStyles.textField, GUILayout.Height(EditorGUIUtility.singleLineHeight));
                _showToken = GUILayout.Toggle(_showToken, "Show", EditorStyles.miniButton, GUILayout.Width(48f));
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Copy Token"))
                {
                    EditorGUIUtility.systemCopyBuffer = BridgeSettings.Token;
                }
                if (GUILayout.Button("Regenerate"))
                {
                    if (EditorUtility.DisplayDialog(
                            "Regenerate token?",
                            "Existing clients will need the new token and the bridge will restart.",
                            "Regenerate", "Cancel"))
                    {
                        BridgeSettings.RegenerateToken();
                        EditorBridgeServer.Restart();
                    }
                }
            }
        }

        private void DrawClientConfig()
        {
            EditorGUILayout.LabelField("Client Config Snippet", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(
                "Paste into your MCP client (e.g. claude_desktop_config.json).",
                EditorStyles.miniLabel);

            string snippet = BuildClientConfigSnippet();
            using (var scroll = new EditorGUILayout.ScrollViewScope(_snippetScroll, GUILayout.Height(140f)))
            {
                _snippetScroll = scroll.scrollPosition;
                EditorGUILayout.TextArea(snippet, GUILayout.ExpandHeight(true));
            }
            if (GUILayout.Button("Copy Config Snippet"))
            {
                EditorGUIUtility.systemCopyBuffer = snippet;
            }
        }

        private void DrawLog()
        {
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.LabelField("Tool Call Log", EditorStyles.boldLabel);
                if (GUILayout.Button("Clear", EditorStyles.miniButton, GUILayout.Width(48f)))
                {
                    ToolCallLog.Clear();
                }
            }

            using var scroll = new EditorGUILayout.ScrollViewScope(_logScroll, GUILayout.ExpandHeight(true));
            _logScroll = scroll.scrollPosition;

            var entries = ToolCallLog.Recent;
            if (entries.Count == 0)
            {
                EditorGUILayout.LabelField("No tool calls yet.", EditorStyles.miniLabel);
                return;
            }

            for (int i = entries.Count - 1; i >= 0; i--)
            {
                ToolCallEntry entry = entries[i];
                string time = entry.TimestampUtc.ToLocalTime().ToString("HH:mm:ss");
                string line = $"[{time}] {entry.Tool} — {entry.Status}";
                if (!string.IsNullOrEmpty(entry.Detail)) line += $": {entry.Detail}";
                EditorGUILayout.LabelField(line, StatusStyle(entry.Status));
            }
        }

        private static GUIStyle StatusStyle(ToolCallStatus status)
        {
            var style = new GUIStyle(EditorStyles.label) { wordWrap = true };
            switch (status)
            {
                case ToolCallStatus.Failed:
                    style.normal.textColor = new Color(0.85f, 0.3f, 0.3f);
                    break;
                case ToolCallStatus.Succeeded:
                    style.normal.textColor = new Color(0.3f, 0.7f, 0.4f);
                    break;
            }
            return style;
        }

        private static string BuildClientConfigSnippet()
        {
            string host = BridgeSettings.Host;
            int port = BridgeSettings.Port;
            string token = BridgeSettings.Token;

            var sb = new StringBuilder();
            sb.AppendLine("{");
            sb.AppendLine("  \"mcpServers\": {");
            sb.AppendLine("    \"unity-conv-mcp\": {");
            sb.AppendLine("      \"command\": \"npx\",");
            sb.AppendLine("      \"args\": [\"-y\", \"@lyx/unity-conv-mcp-sidecar\"],");
            sb.AppendLine("      \"env\": {");
            sb.AppendLine($"        \"UNITY_MCP_HOST\": \"{host}\",");
            sb.AppendLine($"        \"UNITY_MCP_PORT\": \"{port}\",");
            sb.AppendLine($"        \"UNITY_MCP_TOKEN\": \"{token}\"");
            sb.AppendLine("      }");
            sb.AppendLine("    }");
            sb.AppendLine("  }");
            sb.Append("}");
            return sb.ToString();
        }
    }
}
