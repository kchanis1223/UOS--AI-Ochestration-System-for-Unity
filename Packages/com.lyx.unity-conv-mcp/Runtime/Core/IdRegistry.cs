using System;
using System.Collections.Generic;

namespace Lyx.UnityConvMcp
{
    /// <summary>Hint-&gt;canonical pairing returned to the client after generation.</summary>
    public readonly struct HintCanonicalPair
    {
        public readonly string ClientHintId;
        public readonly string ElementId;

        public HintCanonicalPair(string clientHintId, string elementId)
        {
            ClientHintId = clientHintId;
            ElementId = elementId;
        }
    }

    /// <summary>
    /// The server (Unity Editor) is the canonical ID authority. This registry mints canonical
    /// screen/element ids and maintains the in-call hint-&gt;canonical map used to resolve a child's
    /// parentClientHintId during a single create_ui_screen call. Client hint ids are advisory and
    /// authoritative only for intra-call tree linkage; later edits address elements by canonical id.
    ///
    /// Pure C# (no Unity dependency) -> fully EditMode/PlayMode testable. The id generator is
    /// injectable so tests get deterministic ids.
    /// </summary>
    public sealed class IdRegistry
    {
        private readonly Func<string> _elementIdFactory;
        private readonly Func<string> _screenIdFactory;
        private readonly Dictionary<string, string> _hintToCanonical = new Dictionary<string, string>();
        private readonly HashSet<string> _issuedCanonical = new HashSet<string>();
        private readonly List<HintCanonicalPair> _pairs = new List<HintCanonicalPair>();

        public IdRegistry(Func<string> elementIdFactory = null, Func<string> screenIdFactory = null)
        {
            _elementIdFactory = elementIdFactory ?? (() => "elem-" + Guid.NewGuid().ToString("N"));
            _screenIdFactory = screenIdFactory ?? (() => "screen-" + Guid.NewGuid().ToString("N"));
        }

        public string MintScreenId()
        {
            return EnsureUnique(_screenIdFactory);
        }

        /// <summary>
        /// Mint a canonical element id and, if a non-empty hint is given, record the pairing.
        /// Throws if the hint was already bound in this call (duplicate hint).
        /// </summary>
        public string RegisterElement(string clientHintId)
        {
            string canonical = EnsureUnique(_elementIdFactory);
            if (!string.IsNullOrEmpty(clientHintId))
            {
                if (_hintToCanonical.ContainsKey(clientHintId))
                {
                    throw new InvalidOperationException($"duplicate clientHintId \"{clientHintId}\"");
                }
                _hintToCanonical[clientHintId] = canonical;
            }
            _pairs.Add(new HintCanonicalPair(clientHintId ?? string.Empty, canonical));
            return canonical;
        }

        /// <summary>Resolve a parent hint to its canonical id (false if unbound / null hint).</summary>
        public bool TryResolveCanonical(string clientHintId, out string canonical)
        {
            if (string.IsNullOrEmpty(clientHintId))
            {
                canonical = null;
                return false;
            }
            return _hintToCanonical.TryGetValue(clientHintId, out canonical);
        }

        public IReadOnlyList<HintCanonicalPair> Pairs => _pairs;

        public int Count => _pairs.Count;

        // Reissue on the (GUID-improbable, but contractual) collision case.
        private string EnsureUnique(Func<string> factory)
        {
            string id = factory();
            int guard = 0;
            while (_issuedCanonical.Contains(id))
            {
                id = factory();
                if (++guard > 1000)
                {
                    throw new InvalidOperationException("id factory failed to produce a unique id");
                }
            }
            _issuedCanonical.Add(id);
            return id;
        }
    }
}
