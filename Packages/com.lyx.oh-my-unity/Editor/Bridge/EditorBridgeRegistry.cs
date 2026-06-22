using System;
using System.Diagnostics;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace Lyx.OhMyUnity.Editor
{
    /// <summary>
    /// Publishes live Unity Editor bridge endpoints to a local per-user registry so the local
    /// UOS launcher can discover connected projects without being started from a Unity project cwd.
    /// </summary>
    internal static class EditorBridgeRegistry
    {
        private const string SessionKey = "Lyx.OhMyUnity.EditorInstanceId";

        public static string InstanceId
        {
            get
            {
                string id = SessionState.GetString(SessionKey, string.Empty);
                if (string.IsNullOrEmpty(id))
                {
                    id = Guid.NewGuid().ToString("N");
                    SessionState.SetString(SessionKey, id);
                }
                return id;
            }
        }

        public static void Publish(string host, int port, string token)
        {
            try
            {
                Directory.CreateDirectory(RegistryDir);
                ProjectInfoData info = BridgeProjectInfo.Create(host, port, InstanceId);

                var entry = new EditorRegistryEntry
                {
                    instanceId = InstanceId,
                    projectPath = info.projectPath,
                    projectName = info.projectName,
                    host = host,
                    port = port,
                    token = token,
                    unityVersion = info.unityVersion,
                    uosPackageName = info.uosPackageName,
                    uosPackageVersion = info.uosPackageVersion,
                    protocolVersion = info.protocolVersion,
                    autoStartBridge = info.autoStartBridge,
                    processId = Process.GetCurrentProcess().Id,
                    updatedAtUtc = DateTime.UtcNow.ToString("o"),
                };
                File.WriteAllText(EntryPath, JsonUtility.ToJson(entry, true));
            }
            catch (Exception ex)
            {
                UnityEngine.Debug.LogWarning($"[OhMyUnity] failed to publish editor registry entry: {ex.Message}");
            }
        }

        public static void Remove()
        {
            try
            {
                string path = EntryPath;
                if (File.Exists(path)) File.Delete(path);
            }
            catch
            {
                // Best effort during assembly reload / process shutdown.
            }
        }

        private static string EntryPath => Path.Combine(RegistryDir, InstanceId + ".json");

        private static string RegistryDir
        {
            get
            {
                string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                if (string.IsNullOrEmpty(local))
                {
                    local = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                        "AppData",
                        "Local");
                }
                return Path.Combine(local, "oh-my-unity", "editors");
            }
        }

        [Serializable]
        private sealed class EditorRegistryEntry
        {
            public string instanceId;
            public string projectPath;
            public string projectName;
            public string host;
            public int port;
            public string token;
            public string unityVersion;
            public string uosPackageName;
            public string uosPackageVersion;
            public string protocolVersion;
            public bool autoStartBridge;
            public int processId;
            public string updatedAtUtc;
        }
    }
}
