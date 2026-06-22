using Lyx.OhMyUnity.Editor;
using NUnit.Framework;

namespace Lyx.OhMyUnity.Tests
{
    [TestFixture]
    public sealed class BridgeSettingsTests
    {
        private bool _originalAutoStart;

        [SetUp]
        public void SetUp()
        {
            _originalAutoStart = BridgeSettings.AutoStart;
        }

        [TearDown]
        public void TearDown()
        {
            BridgeSettings.AutoStart = _originalAutoStart;
        }

        [Test]
        public void AutoStart_IsPersisted()
        {
            BridgeSettings.AutoStart = false;
            Assert.IsFalse(BridgeSettings.AutoStart);

            BridgeSettings.AutoStart = true;
            Assert.IsTrue(BridgeSettings.AutoStart);
        }
    }
}
