using System;
using UnityEditor;

namespace Lyx.UnityConvMcp.Editor
{
    /// <summary>
    /// Wraps one tool call's scene mutations in a single collapsed Undo group so the user can revert
    /// an entire generation/edit with one Ctrl+Z (AC-4). If the call fails or the socket drops
    /// mid-pump, <see cref="Abort"/> reverts the partial mutation so no half-built tree is left
    /// behind (risk R7).
    /// </summary>
    public sealed class UndoScope : IDisposable
    {
        private readonly int _group;
        private bool _committed;
        private bool _disposed;

        public UndoScope(string label)
        {
            Undo.IncrementCurrentGroup();
            _group = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName(label);
        }

        /// <summary>Register a created object so it is removed on undo/abort.</summary>
        public void RegisterCreated(UnityEngine.Object created)
        {
            Undo.RegisterCreatedObjectUndo(created, "Create");
        }

        /// <summary>Record an object's state before modifying it.</summary>
        public void RecordObject(UnityEngine.Object target, string name)
        {
            Undo.RecordObject(target, name);
        }

        /// <summary>Mark the call successful; the group is collapsed on dispose.</summary>
        public void Commit()
        {
            _committed = true;
        }

        /// <summary>Revert every mutation registered in this group.</summary>
        public void Abort()
        {
            Undo.RevertAllDownToGroup(_group);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            if (_committed)
            {
                Undo.CollapseUndoOperations(_group);
            }
            else
            {
                // Defensive: a scope disposed without Commit reverts its partial work.
                Undo.RevertAllDownToGroup(_group);
            }
        }
    }
}
