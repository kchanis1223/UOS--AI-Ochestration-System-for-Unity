using System;
using Lyx.OhMyUnity.Editor;
using NUnit.Framework;

namespace Lyx.OhMyUnity.Tests
{
    [TestFixture]
    public sealed class BridgeSettingsTests
    {
        private bool _originalAutoStart;
        private string _originalHostEnv;
        private string _originalPortEnv;
        private string _originalTokenEnv;
        private string _originalGuiSessionEnv;

        [SetUp]
        public void SetUp()
        {
            _originalAutoStart = BridgeSettings.AutoStart;
            _originalHostEnv = Environment.GetEnvironmentVariable("UOS_BRIDGE_HOST");
            _originalPortEnv = Environment.GetEnvironmentVariable("UOS_BRIDGE_PORT");
            _originalTokenEnv = Environment.GetEnvironmentVariable("UOS_BRIDGE_TOKEN");
            _originalGuiSessionEnv = Environment.GetEnvironmentVariable("UOS_GUI_SESSION_ID");
        }

        [TearDown]
        public void TearDown()
        {
            BridgeSettings.AutoStart = _originalAutoStart;
            Environment.SetEnvironmentVariable("UOS_BRIDGE_HOST", _originalHostEnv);
            Environment.SetEnvironmentVariable("UOS_BRIDGE_PORT", _originalPortEnv);
            Environment.SetEnvironmentVariable("UOS_BRIDGE_TOKEN", _originalTokenEnv);
            Environment.SetEnvironmentVariable("UOS_GUI_SESSION_ID", _originalGuiSessionEnv);
        }

        [Test]
        public void AutoStart_IsPersisted()
        {
            BridgeSettings.AutoStart = false;
            Assert.IsFalse(BridgeSettings.AutoStart);

            BridgeSettings.AutoStart = true;
            Assert.IsTrue(BridgeSettings.AutoStart);
        }

        [Test]
        public void GuiLaunchEnvironment_OverridesEditorPrefs()
        {
            Environment.SetEnvironmentVariable("UOS_BRIDGE_HOST", "127.0.0.2");
            Environment.SetEnvironmentVariable("UOS_BRIDGE_PORT", "19001");
            Environment.SetEnvironmentVariable("UOS_BRIDGE_TOKEN", "gui-token");
            Environment.SetEnvironmentVariable("UOS_GUI_SESSION_ID", "gui-session");

            Assert.AreEqual("127.0.0.2", BridgeSettings.Host);
            Assert.AreEqual(19001, BridgeSettings.Port);
            Assert.AreEqual("gui-token", BridgeSettings.Token);
            Assert.AreEqual("gui-session", BridgeSettings.GuiSessionId);
        }
    }
}
