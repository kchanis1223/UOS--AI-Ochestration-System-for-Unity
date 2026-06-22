using Lyx.OhMyUnity.Editor;
using NUnit.Framework;

namespace Lyx.OhMyUnity.Tests
{
    [TestFixture]
    public sealed class MonitorWindowTests
    {
        [Test]
        public void UosLauncherSnippet_GuidesLocalUosSelectionAndExplicitBridgeFallback()
        {
            string snippet = MonitorWindow.BuildUosLauncherSnippet();

            StringAssert.Contains("uos projects", snippet);
            StringAssert.Contains("uos --unity-project", snippet);
            StringAssert.Contains("$env:UNITY_MCP_HOST", snippet);
            StringAssert.Contains("$env:UNITY_MCP_PORT", snippet);
            StringAssert.Contains("$env:UNITY_MCP_TOKEN", snippet);
            StringAssert.Contains("$env:UOS_PROJECT_DIR", snippet);
            StringAssert.Contains("uos context", snippet);
            Assert.IsFalse(snippet.Contains("mcpServers"));
            Assert.IsFalse(snippet.Contains("@lyx/unity-conv-mcp-sidecar"));
        }
    }
}
