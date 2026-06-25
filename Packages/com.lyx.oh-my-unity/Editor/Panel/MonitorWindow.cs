using System;
using System.Text;
using UnityEditor;
using UnityEngine;

namespace Lyx.OhMyUnity.Editor
{
    /// <summary>
    /// Passive monitor/dashboard for the UOS bridge (AC-8: monitor, never a chat surface). Shows the
    /// listener status, the shared token + copyable UOS launcher fallback env, and a live tool-call log
    /// fed by <see cref="ToolCallLog"/>.
    ///
    /// All generation is driven by the external client over the bridge; this window only observes.
    /// </summary>
    public sealed class MonitorWindow : EditorWindow
    {
        private Vector2 _logScroll;
        private Vector2 _snippetScroll;
        private bool _showToken;

        [MenuItem("Window/Oh My Unity/Monitor")]
        public static void Open()
        {
            MonitorWindow window = GetWindow<MonitorWindow>();
            window.titleContent = new GUIContent("Oh My Unity");
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
            DrawUosLauncherSnippet();
            EditorGUILayout.Space();
            DrawLog();
        }

        private void DrawStatus()
        {
            EditorGUILayout.LabelField("Bridge Status", EditorStyles.boldLabel);
            bool autoStart = BridgeSettings.AutoStart;
            bool nextAutoStart = EditorGUILayout.ToggleLeft("Auto start bridge when this Unity project opens", autoStart);
            if (nextAutoStart != autoStart)
            {
                BridgeSettings.AutoStart = nextAutoStart;
                if (nextAutoStart && !EditorBridgeServer.IsRunning)
                {
                    EditorBridgeServer.Start();
                }
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                bool running = EditorBridgeServer.IsRunning;
                string state = running
                    ? $"Listening on ws://{EditorBridgeServer.Host}:{EditorBridgeServer.Port}"
                    : "Stopped";
                EditorGUILayout.LabelField("Server", state);
            }
            EditorGUILayout.LabelField("Connected clients", EditorBridgeServer.ConnectedClients.ToString());
            string guiSessionId = BridgeSettings.GuiSessionId;
            bool guiManaged = !string.IsNullOrEmpty(guiSessionId);
            EditorGUILayout.LabelField("Control", guiManaged ? "GUI-managed bridge" : "Manual bridge");
            if (guiManaged)
            {
                EditorGUILayout.LabelField("GUI session id", guiSessionId);
            }

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
                        BridgeSettings.AutoStart = false;
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
                string token = ActiveBridgeToken();
                string shown = _showToken ? token : new string('*', Math.Min(token.Length, 24));
                EditorGUILayout.SelectableLabel(shown, EditorStyles.textField, GUILayout.Height(EditorGUIUtility.singleLineHeight));
                _showToken = GUILayout.Toggle(_showToken, "Show", EditorStyles.miniButton, GUILayout.Width(48f));
            }
            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Copy Token"))
                {
                    EditorGUIUtility.systemCopyBuffer = ActiveBridgeToken();
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

        private void DrawUosLauncherSnippet()
        {
            EditorGUILayout.LabelField("UOS Launcher Snippet", EditorStyles.boldLabel);
            EditorGUILayout.LabelField(
                "GUI Chat only uses a GUI-managed bridge. Explicit env is a CLI fallback.",
                EditorStyles.miniLabel);

            string snippet = BuildUosLauncherSnippet();
            using (var scroll = new EditorGUILayout.ScrollViewScope(_snippetScroll, GUILayout.Height(140f)))
            {
                _snippetScroll = scroll.scrollPosition;
                EditorGUILayout.TextArea(snippet, GUILayout.ExpandHeight(true));
            }
            if (GUILayout.Button("Copy UOS Snippet"))
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
                string line = $"[{time}] {entry.Tool} -> {entry.Status}";
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

        internal static string BuildUosLauncherSnippet()
        {
            string host = EditorBridgeServer.Host;
            int port = EditorBridgeServer.Port;
            string token = ActiveBridgeToken();
            ProjectInfoData info = BridgeProjectInfo.Create(host, port);

            var sb = new StringBuilder();
            sb.AppendLine("# Preferred local UOS flow");
            sb.AppendLine("uos projects");
            if (!string.IsNullOrEmpty(info.editorInstanceId))
                sb.AppendLine($"uos --unity-project {PowerShellQuote(info.editorInstanceId)}");
            else if (!string.IsNullOrEmpty(info.projectName))
                sb.AppendLine($"uos --unity-project {PowerShellQuote(info.projectName)}");
            else
                sb.AppendLine("uos --unity-project <selector>");
            sb.AppendLine();
            sb.AppendLine("# Explicit bridge fallback for this Editor");
            sb.AppendLine($"$env:UNITY_MCP_HOST = {PowerShellQuote(host)}");
            sb.AppendLine($"$env:UNITY_MCP_PORT = {PowerShellQuote(port.ToString())}");
            sb.AppendLine($"$env:UNITY_MCP_TOKEN = {PowerShellQuote(token)}");
            if (!string.IsNullOrEmpty(info.projectPath))
                sb.AppendLine($"$env:UOS_PROJECT_DIR = {PowerShellQuote(info.projectPath)}");
            if (!string.IsNullOrEmpty(info.projectName))
                sb.AppendLine($"$env:UOS_PROJECT_NAME = {PowerShellQuote(info.projectName)}");
            if (!string.IsNullOrEmpty(info.editorInstanceId))
                sb.AppendLine($"$env:UOS_EDITOR_INSTANCE_ID = {PowerShellQuote(info.editorInstanceId)}");
            sb.Append("uos context");
            return sb.ToString();
        }

        private static string PowerShellQuote(string value)
        {
            return "'" + (value ?? string.Empty).Replace("'", "''") + "'";
        }

        private static string ActiveBridgeToken()
        {
            return EditorBridgeServer.IsRunning ? EditorBridgeServer.Token : BridgeSettings.Token;
        }
    }
}
