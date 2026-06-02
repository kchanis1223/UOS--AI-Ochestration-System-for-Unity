using System;
using System.Collections.Generic;

namespace Lyx.OhMyUnity.Editor
{
    public enum ToolCallStatus
    {
        Received,
        Succeeded,
        Failed,
    }

    public readonly struct ToolCallEntry
    {
        public readonly DateTime TimestampUtc;
        public readonly string Tool;
        public readonly ToolCallStatus Status;
        public readonly string Detail;

        public ToolCallEntry(string tool, ToolCallStatus status, string detail)
        {
            TimestampUtc = DateTime.UtcNow;
            Tool = tool;
            Status = status;
            Detail = detail;
        }
    }

    /// <summary>
    /// In-memory event bus the bridge writes to and the MonitorWindow subscribes to. Decouples the
    /// socket/dispatch layer from the panel UI (the panel is a passive monitor, no chat).
    /// </summary>
    public static class ToolCallLog
    {
        private const int MaxEntries = 200;
        private static readonly List<ToolCallEntry> Entries = new List<ToolCallEntry>();

        public static event Action<ToolCallEntry> EntryAdded;
        public static event Action Changed;

        public static IReadOnlyList<ToolCallEntry> Recent => Entries;

        public static void Record(string tool, ToolCallStatus status, string detail = null)
        {
            var entry = new ToolCallEntry(tool, status, detail);
            Entries.Add(entry);
            if (Entries.Count > MaxEntries)
            {
                Entries.RemoveRange(0, Entries.Count - MaxEntries);
            }
            EntryAdded?.Invoke(entry);
            Changed?.Invoke();
        }

        public static void Clear()
        {
            Entries.Clear();
            Changed?.Invoke();
        }
    }
}
