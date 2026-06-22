using UnityEngine;

namespace Lyx.OhMyUnity
{
    /// <summary>
    /// Persistent canonical id marker for non-UI scene objects created through UOS.
    /// This lets follow-up bridge calls find the exact GameObject even after it is
    /// renamed or moved in the Unity Editor hierarchy.
    /// </summary>
    [DisallowMultipleComponent]
    public sealed class SceneObjectId : MonoBehaviour
    {
        [SerializeField] private string objectId;
        [SerializeField] private string objectType;

        public string ObjectId => objectId;
        public string ObjectType => objectType;

        public void Assign(string id)
        {
            Assign(id, string.Empty);
        }

        public void Assign(string id, string type)
        {
            objectId = id;
            objectType = type;
        }
    }
}
