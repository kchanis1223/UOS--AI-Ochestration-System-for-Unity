using System.Collections.Generic;

namespace Lyx.OhMyUnity.Editor
{
    /// <summary>Result of a create_ui_screen call: canonical screen id + hint->canonical pairs.</summary>
    public sealed class CreateScreenResult
    {
        public string ScreenId;
        public List<HintCanonicalPair> Elements = new List<HintCanonicalPair>();
    }

    /// <summary>
    /// Abstraction over the UI stack (decision B1: uGUI v1, with B2 UI Toolkit as a future backend).
    /// All methods run on the Unity main thread and are expected to be wrapped in an UndoScope by
    /// the caller. The server is the canonical id authority; intent clientHintIds are advisory.
    /// </summary>
    public interface IUiBackend
    {
        /// <summary>Generate a Canvas + element tree from an intent. Returns server-minted ids.</summary>
        CreateScreenResult CreateScreen(PlanningIntentData intent, UndoScope undo);

        /// <summary>Add one element to an existing screen. Returns its canonical id.</summary>
        string AddElement(string screenId, IntentElementData element, UndoScope undo);

        /// <summary>Update properties / rect of an element addressed by canonical id.</summary>
        bool UpdateElement(string elementId, NormRectData rect, string anchor, ElementProps props, UndoScope undo);

        /// <summary>Delete an element addressed by canonical id.</summary>
        bool DeleteElement(string elementId, UndoScope undo);

        /// <summary>Activate one registered screen and deactivate the other registered screens.</summary>
        bool SetActiveScreen(string screenId, UndoScope undo);

        /// <summary>List the screen ids currently in the scene.</summary>
        IReadOnlyList<string> ListScreens();
    }
}
