using System;
using System.Collections.Generic;
using UnityEngine;

namespace Lyx.UnityConvMcp
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

        public string ActiveScreenId => activeScreenId;
        public IReadOnlyList<string> ScreenIds => screenIds;
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

        /// <summary>Activate the target screen and deactivate all others.</summary>
        public bool ShowScreen(string screenId)
        {
            int index = screenIds.IndexOf(screenId);
            if (index < 0) return false;

            for (int i = 0; i < screenObjects.Count; i++)
            {
                if (screenObjects[i] != null)
                {
                    screenObjects[i].SetActive(i == index);
                }
            }
            activeScreenId = screenId;
            return true;
        }

        /// <summary>Follow a declared transition from the active screen matching the trigger.</summary>
        public bool Fire(string trigger)
        {
            foreach (ScreenTransition t in transitions)
            {
                if (t.fromScreenId == activeScreenId && t.trigger == trigger)
                {
                    return ShowScreen(t.toScreenId);
                }
            }
            return false;
        }
    }
}
