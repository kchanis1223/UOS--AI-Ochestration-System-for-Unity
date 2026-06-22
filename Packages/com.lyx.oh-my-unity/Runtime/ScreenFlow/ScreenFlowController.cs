using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;

namespace Lyx.OhMyUnity
{
    [Serializable]
    public struct ScreenTransition
    {
        public string fromScreenId;
        public string toScreenId;
        public string trigger;
    }

    /// <summary>
    /// Panel-toggle navigation between screens (decision C1: single Scene + panel toggle).
    /// Screens are child GameObjects toggled active/inactive. Transitions are declared data;
    /// triggers (button elementId / named event) are wired by the Editor generation step.
    /// </summary>
    public sealed class ScreenFlowController : MonoBehaviour
    {
        [SerializeField] private List<string> screenIds = new List<string>();
        [SerializeField] private List<GameObject> screenObjects = new List<GameObject>();
        [SerializeField] private List<ScreenTransition> transitions = new List<ScreenTransition>();
        [SerializeField] private string activeScreenId;
        [Tooltip("Screen cross-fade duration in seconds (runtime only; 0 = instant).")]
        [SerializeField] private float transitionDuration = 0.25f;
        private readonly Stack<string> history = new Stack<string>();
        private Coroutine transitionRoutine;

        public string ActiveScreenId => activeScreenId;
        public IReadOnlyList<string> ScreenIds => screenIds;
        public IReadOnlyList<GameObject> ScreenObjects => screenObjects;
        public IReadOnlyList<ScreenTransition> Transitions => transitions;

        public void RegisterScreen(string screenId, GameObject screenObject)
        {
            int existing = screenIds.IndexOf(screenId);
            if (existing >= 0)
            {
                screenObjects[existing] = screenObject;
                return;
            }
            screenIds.Add(screenId);
            screenObjects.Add(screenObject);
        }

        public void AddTransition(ScreenTransition transition)
        {
            transitions.Add(transition);
        }

        /// <summary>Activate the target screen and deactivate all others (cross-fades at runtime).</summary>
        public bool ShowScreen(string screenId)
        {
            int index = screenIds.IndexOf(screenId);
            if (index < 0) return false;
            activeScreenId = screenId;

            if (Application.isPlaying && isActiveAndEnabled && transitionDuration > 0f)
            {
                if (transitionRoutine != null) StopCoroutine(transitionRoutine);
                transitionRoutine = StartCoroutine(TransitionTo(index));
            }
            else
            {
                ApplyInstant(index);
            }
            return true;
        }

        private void ApplyInstant(int index)
        {
            for (int i = 0; i < screenObjects.Count; i++)
            {
                GameObject go = screenObjects[i];
                if (go == null) continue;
                bool on = i == index;
                go.SetActive(on);
                CanvasGroup cg = go.GetComponent<CanvasGroup>();
                if (cg != null) { cg.alpha = 1f; cg.blocksRaycasts = on; }
            }
        }

        private IEnumerator TransitionTo(int index)
        {
            GameObject target = (index >= 0 && index < screenObjects.Count) ? screenObjects[index] : null;

            List<CanvasGroup> fadingOut = new List<CanvasGroup>();
            for (int i = 0; i < screenObjects.Count; i++)
            {
                GameObject go = screenObjects[i];
                if (go == null || i == index) continue;
                if (go.activeSelf)
                {
                    CanvasGroup cg = EnsureCanvasGroup(go);
                    cg.blocksRaycasts = false;
                    fadingOut.Add(cg);
                }
            }

            CanvasGroup targetCg = null;
            if (target != null)
            {
                targetCg = EnsureCanvasGroup(target);
                if (target.activeSelf && fadingOut.Count == 0)
                {
                    targetCg.alpha = 1f;
                    targetCg.blocksRaycasts = true;
                    transitionRoutine = null;
                    yield break;
                }
                target.SetActive(true);
                targetCg.alpha = 0f;
                targetCg.blocksRaycasts = false;
            }

            float t = 0f;
            while (t < transitionDuration)
            {
                t += Time.unscaledDeltaTime;
                float k = Mathf.Clamp01(t / transitionDuration);
                if (targetCg != null) targetCg.alpha = k;
                for (int i = 0; i < fadingOut.Count; i++)
                {
                    if (fadingOut[i] != null) fadingOut[i].alpha = 1f - k;
                }
                yield return null;
            }

            for (int i = 0; i < fadingOut.Count; i++)
            {
                if (fadingOut[i] == null) continue;
                fadingOut[i].alpha = 1f;
                fadingOut[i].gameObject.SetActive(false);
            }
            if (targetCg != null)
            {
                targetCg.alpha = 1f;
                targetCg.blocksRaycasts = true;
            }
            transitionRoutine = null;
        }

        private static CanvasGroup EnsureCanvasGroup(GameObject go)
        {
            CanvasGroup cg = go.GetComponent<CanvasGroup>();
            if (cg == null) cg = go.AddComponent<CanvasGroup>();
            return cg;
        }

        /// <summary>Navigate forward to a screen, remembering the current one for Back.</summary>
        public bool NavigateTo(string screenId)
        {
            if (string.IsNullOrEmpty(screenId) || screenId == activeScreenId) return false;
            if (!string.IsNullOrEmpty(activeScreenId)) history.Push(activeScreenId);
            return ShowScreen(screenId);
        }

        /// <summary>Return to the previously visited screen (true history back), if any.</summary>
        public bool GoBack()
        {
            while (history.Count > 0)
            {
                string previous = history.Pop();
                if (!string.IsNullOrEmpty(previous) && previous != activeScreenId && screenIds.Contains(previous))
                {
                    return ShowScreen(previous);
                }
            }
            return false;
        }

        /// <summary>Jump to the home screen and clear navigation history.</summary>
        public bool GoHome(string homeScreenId)
        {
            history.Clear();
            return ShowScreen(homeScreenId);
        }

        /// <summary>Follow a declared transition from the active screen matching the trigger.</summary>
        public bool Fire(string trigger)
        {
            foreach (ScreenTransition t in transitions)
            {
                if (t.fromScreenId == activeScreenId && t.trigger == trigger)
                {
                    if (ShowScreen(t.toScreenId)) return true;
                }
            }
            return false;
        }

        private void Awake()
        {
            EnsureEventSystem();
            WireTriggers();
            if (!string.IsNullOrEmpty(activeScreenId))
            {
                ShowScreen(activeScreenId);
            }
        }

        /// <summary>
        /// Runtime: bind each transition trigger Button.onClick to navigate to the target screen.
        /// Trigger ids are matched to GameObjects via ScreenElementId. Only transitions whose
        /// target screen is registered are wired (stale targets are skipped).
        /// </summary>
        public void WireTriggers()
        {
            ScreenElementId[] markers = UnityEngine.Object.FindObjectsByType<ScreenElementId>(
                FindObjectsInactive.Include, FindObjectsSortMode.None);

            foreach (ScreenTransition transition in transitions)
            {
                if (string.IsNullOrEmpty(transition.trigger)) continue;
                if (!screenIds.Contains(transition.toScreenId)) continue;

                GameObject triggerObject = null;
                for (int i = 0; i < markers.Length; i++)
                {
                    if (markers[i] != null && markers[i].ElementId == transition.trigger)
                    {
                        triggerObject = markers[i].gameObject;
                        break;
                    }
                }
                if (triggerObject == null) continue;

                Button button = triggerObject.GetComponent<Button>();
                if (button == null) continue;

                string triggerName = triggerObject.name;
                if (triggerName == "backBtn")
                {
                    button.onClick.AddListener(() => GoBack());
                }
                else if (triggerName == "homeBtn")
                {
                    string home = transition.toScreenId;
                    button.onClick.AddListener(() => GoHome(home));
                }
                else
                {
                    string target = transition.toScreenId;
                    button.onClick.AddListener(() => NavigateTo(target));
                }
            }
        }

        /// <summary>
        /// Ensure the scene has an EventSystem so generated UI is clickable. Prefers the new
        /// Input System UI module when the Input System package is present; otherwise falls back
        /// to the legacy StandaloneInputModule. Safe to call repeatedly.
        /// </summary>
        public static void EnsureEventSystem()
        {
            if (UnityEngine.Object.FindFirstObjectByType<EventSystem>() != null) return;

            var go = new GameObject("EventSystem");
            go.AddComponent<EventSystem>();

            System.Type inputModuleType = System.Type.GetType(
                "UnityEngine.InputSystem.UI.InputSystemUIInputModule, Unity.InputSystem");
            if (inputModuleType != null)
            {
                Component module = go.AddComponent(inputModuleType);
                System.Reflection.MethodInfo assign = inputModuleType.GetMethod("AssignDefaultActions");
                if (assign != null)
                {
                    assign.Invoke(module, null);
                }
            }
            else
            {
                go.AddComponent<StandaloneInputModule>();
            }
        }
    }
}
