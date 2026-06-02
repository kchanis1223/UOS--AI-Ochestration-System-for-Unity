using NUnit.Framework;
using System;
using System.Collections.Generic;

namespace Lyx.UnityConvMcp.Tests
{
    /// <summary>
    /// Pins the canonical-id authority contract: the server mints ids; hints are advisory and
    /// authoritative only for intra-call linkage. Deterministic factories let us assert exact ids.
    /// </summary>
    [TestFixture]
    public sealed class IdRegistryTests
    {
        private static IdRegistry NewRegistry()
        {
            int eCounter = 0, sCounter = 0;
            return new IdRegistry(
                elementIdFactory: () => $"elem-{++eCounter}",
                screenIdFactory: () => $"screen-{++sCounter}");
        }

        [Test]
        public void MintScreenId_ReturnsSequentialIds()
        {
            IdRegistry r = NewRegistry();
            Assert.AreEqual("screen-1", r.MintScreenId());
            Assert.AreEqual("screen-2", r.MintScreenId());
        }

        [Test]
        public void RegisterElement_BindsHintToCanonical()
        {
            IdRegistry r = NewRegistry();
            string id = r.RegisterElement("title");
            Assert.AreEqual("elem-1", id);
            Assert.IsTrue(r.TryResolveCanonical("title", out string resolved));
            Assert.AreEqual("elem-1", resolved);
        }

        [Test]
        public void RegisterElement_AcceptsNullOrEmptyHint()
        {
            IdRegistry r = NewRegistry();
            string id = r.RegisterElement(null);
            Assert.AreEqual("elem-1", id);
            Assert.AreEqual(1, r.Count);
            Assert.IsFalse(r.TryResolveCanonical(null, out _));
            Assert.IsFalse(r.TryResolveCanonical(string.Empty, out _));
        }

        [Test]
        public void RegisterElement_RejectsDuplicateHint()
        {
            IdRegistry r = NewRegistry();
            r.RegisterElement("dup");
            Assert.Throws<InvalidOperationException>(() => r.RegisterElement("dup"));
        }

        [Test]
        public void Pairs_PreservesInsertionOrder()
        {
            IdRegistry r = NewRegistry();
            r.RegisterElement("a");
            r.RegisterElement(null);
            r.RegisterElement("b");

            IReadOnlyList<HintCanonicalPair> pairs = r.Pairs;
            Assert.AreEqual(3, pairs.Count);
            Assert.AreEqual("a", pairs[0].ClientHintId);
            Assert.AreEqual("elem-1", pairs[0].ElementId);
            Assert.AreEqual(string.Empty, pairs[1].ClientHintId);
            Assert.AreEqual("elem-2", pairs[1].ElementId);
            Assert.AreEqual("b", pairs[2].ClientHintId);
            Assert.AreEqual("elem-3", pairs[2].ElementId);
        }

        [Test]
        public void EnsureUnique_RetriesOnCollision()
        {
            int call = 0;
            // First two calls collide, third returns a fresh id.
            var registry = new IdRegistry(
                elementIdFactory: () =>
                {
                    call++;
                    return call <= 2 ? "elem-fixed" : $"elem-{call}";
                });
            Assert.AreEqual("elem-fixed", registry.RegisterElement(null));
            Assert.AreEqual("elem-3", registry.RegisterElement(null));
        }

        [Test]
        public void EnsureUnique_GivesUpAfterTooManyCollisions()
        {
            var registry = new IdRegistry(elementIdFactory: () => "always-same");
            registry.RegisterElement(null);
            Assert.Throws<InvalidOperationException>(() => registry.RegisterElement(null));
        }
    }
}
