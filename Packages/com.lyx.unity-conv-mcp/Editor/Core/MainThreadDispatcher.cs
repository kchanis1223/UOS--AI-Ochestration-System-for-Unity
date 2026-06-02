using System;
using System.Collections.Concurrent;
using System.Threading.Tasks;
using UnityEditor;

namespace Lyx.UnityConvMcp.Editor
{
    /// <summary>
    /// Marshals work from background socket threads onto the Unity main thread.
    ///
    /// Background socket I/O enqueues Actions here; a pump registered on
    /// <see cref="EditorApplication.update"/> drains the queue on the main thread, where all Unity
    /// API calls are legal. NOTE: EditorApplication.delayCall is deliberately NOT used — it is a
    /// one-shot callback, unsuitable as a continuous pump (per plan decision A1 / risk R1).
    /// </summary>
    [InitializeOnLoad]
    public static class MainThreadDispatcher
    {
        private static readonly ConcurrentQueue<Action> Queue = new ConcurrentQueue<Action>();

        static MainThreadDispatcher()
        {
            EditorApplication.update -= Pump;
            EditorApplication.update += Pump;
        }

        /// <summary>Fire-and-forget: run on the main thread, no result.</summary>
        public static void Enqueue(Action action)
        {
            if (action != null) Queue.Enqueue(action);
        }

        /// <summary>Run a function on the main thread and await its result from a background thread.</summary>
        public static Task<T> EnqueueAsync<T>(Func<T> func)
        {
            var tcs = new TaskCompletionSource<T>();
            Queue.Enqueue(() =>
            {
                try
                {
                    tcs.SetResult(func());
                }
                catch (Exception ex)
                {
                    tcs.SetException(ex);
                }
            });
            return tcs.Task;
        }

        private static void Pump()
        {
            // Bounded drain per tick so a flood cannot stall the Editor frame indefinitely.
            int budget = 64;
            while (budget-- > 0 && Queue.TryDequeue(out Action action))
            {
                try
                {
                    action();
                }
                catch (Exception ex)
                {
                    UnityEngine.Debug.LogError($"[UnityConvMcp] main-thread action threw: {ex}");
                }
            }
        }
    }
}
