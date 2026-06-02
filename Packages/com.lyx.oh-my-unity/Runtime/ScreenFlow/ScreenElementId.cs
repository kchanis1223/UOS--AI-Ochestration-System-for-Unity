using UnityEngine;

namespace Lyx.OhMyUnity
{
    /// <summary>
    /// Persistent canonical id marker attached to every generated screen/element GameObject.
    /// The server is the id authority; this component lets later edits (update/move/delete) locate
    /// the exact target even after the user manually duplicates/edits in the Editor. On duplication
    /// the id collides, so the generator re-issues a fresh id for the copy (handled server-side).
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class ScreenElementId : MonoBehaviour
    {
        [SerializeField] private string elementId;

        /// <summary>Server-minted canonical id. Treated as immutable once assigned.</summary>
        public string ElementId => elementId;

        public void Assign(string id)
        {
            elementId = id;
        }
    }
}
