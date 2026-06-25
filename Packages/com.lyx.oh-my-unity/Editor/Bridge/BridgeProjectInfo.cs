using System;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEngine;

namespace Lyx.OhMyUnity.Editor
{
    /// <summary>
    /// Shared identity payload for get_project_info and the local Editor registry.
    /// Keeping these aligned lets the local UOS launcher and the opencode agent
    /// reason about the same selected Unity Editor target.
    /// </summary>
    internal static class BridgeProjectInfo
    {
        public static ProjectInfoData Create(
            string host,
            int port,
            string instanceId = null,
            string[] supportedTools = null,
            string[] writeTools = null)
        {
            string dataPath = Application.dataPath;
            DirectoryInfo dir = Directory.GetParent(dataPath);
            string projectPath = dir != null ? dir.FullName : dataPath;
            string projectName = dir != null ? dir.Name : Application.productName;
            UnityEditor.PackageManager.PackageInfo package =
                UnityEditor.PackageManager.PackageInfo.FindForAssembly(Assembly.GetExecutingAssembly());

            return new ProjectInfoData
            {
                projectPath = projectPath,
                projectName = projectName,
                unityVersion = Application.unityVersion,
                uosPackageName = package != null ? package.name : "com.lyx.oh-my-unity",
                uosPackageVersion = package != null ? package.version : string.Empty,
                protocolVersion = BridgeSettings.ProtocolVersion,
                bridgeHost = host,
                bridgePort = port,
                autoStartBridge = BridgeSettings.AutoStart,
                editorInstanceId = string.IsNullOrEmpty(instanceId) ? EditorBridgeRegistry.InstanceId : instanceId,
                uosGuiSessionId = BridgeSettings.GuiSessionId,
                supportedTools = supportedTools != null ? (string[])supportedTools.Clone() : Array.Empty<string>(),
                writeTools = writeTools != null ? (string[])writeTools.Clone() : Array.Empty<string>(),
            };
        }
    }

    [Serializable]
    internal sealed class ProjectInfoData
    {
        public string projectPath;
        public string projectName;
        public string unityVersion;
        public string uosPackageName;
        public string uosPackageVersion;
        public string protocolVersion;
        public string bridgeHost;
        public int bridgePort;
        public bool autoStartBridge;
        public string editorInstanceId;
        public string uosGuiSessionId;
        public string[] supportedTools;
        public string[] writeTools;
    }
}
