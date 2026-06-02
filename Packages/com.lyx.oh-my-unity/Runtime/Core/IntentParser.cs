using System.Collections.Generic;

namespace Lyx.OhMyUnity
{
    public sealed class IntentValidationResult
    {
        public bool Ok => Errors.Count == 0;
        public readonly List<string> Errors = new List<string>();
    }

    /// <summary>
    /// Defense-in-depth validation/normalization of a PlanningIntentData on the Unity side,
    /// mirroring the sidecar's schema + tree checks (mcp-server/src/core/intentValidation.ts and
    /// schema.ts). Even though the sidecar preflights, the server validates again before mutating
    /// the scene. Pure C#, no Unity dependency -> EditMode testable.
    /// </summary>
    public static class IntentParser
    {
        private static readonly HashSet<string> AllowedTypes = new HashSet<string>
        {
            "Panel", "Text", "Button", "Image", "InputField", "Toggle", "Slider", "ScrollView", "Dropdown",
        };

        public static IntentValidationResult Validate(PlanningIntentData intent)
        {
            var result = new IntentValidationResult();
            if (intent == null)
            {
                result.Errors.Add("intent is null");
                return result;
            }

            if (intent.version != PlanningIntentData.ExpectedVersion)
            {
                result.Errors.Add($"version must be \"{PlanningIntentData.ExpectedVersion}\", got \"{intent.version}\"");
            }

            if (string.IsNullOrEmpty(intent.screenName))
            {
                result.Errors.Add("screenName is required");
            }

            if (intent.referenceCanvas == null
                || !(intent.referenceCanvas.width > 0f)
                || !(intent.referenceCanvas.height > 0f))
            {
                result.Errors.Add("referenceCanvas must have positive width and height");
            }

            if (intent.elements == null)
            {
                result.Errors.Add("elements is required");
                return result;
            }

            ValidateElements(intent.elements, result);
            return result;
        }

        private static void ValidateElements(IntentElementData[] elements, IntentValidationResult result)
        {
            var hintToIndex = new Dictionary<string, int>();

            for (int i = 0; i < elements.Length; i++)
            {
                IntentElementData el = elements[i];
                if (el == null)
                {
                    result.Errors.Add($"elements[{i}] is null");
                    continue;
                }

                if (!AllowedTypes.Contains(el.type))
                {
                    result.Errors.Add($"elements[{i}] has unknown type \"{el.type}\"");
                }

                ValidateRect(el.rect, i, result);

                if (!string.IsNullOrEmpty(el.clientHintId))
                {
                    if (hintToIndex.ContainsKey(el.clientHintId))
                    {
                        result.Errors.Add($"duplicate clientHintId \"{el.clientHintId}\"");
                    }
                    else
                    {
                        hintToIndex[el.clientHintId] = i;
                    }
                }
            }

            for (int i = 0; i < elements.Length; i++)
            {
                IntentElementData el = elements[i];
                if (el == null || string.IsNullOrEmpty(el.parentClientHintId)) continue;

                if (!string.IsNullOrEmpty(el.clientHintId) && el.parentClientHintId == el.clientHintId)
                {
                    result.Errors.Add($"elements[{i}] (\"{el.clientHintId}\") references itself as parent");
                    continue;
                }
                if (!hintToIndex.ContainsKey(el.parentClientHintId))
                {
                    result.Errors.Add($"elements[{i}] parentClientHintId \"{el.parentClientHintId}\" does not match any clientHintId");
                }
            }

            if (result.Ok)
            {
                string cyclic = FindCyclicHint(elements, hintToIndex);
                if (cyclic != null)
                {
                    result.Errors.Add($"cycle detected in parent references involving \"{cyclic}\"");
                }
            }
        }

        private static void ValidateRect(NormRectData rect, int index, IntentValidationResult result)
        {
            if (rect == null)
            {
                result.Errors.Add($"elements[{index}] rect is required");
                return;
            }
            if (rect.x < 0f || rect.x > 1f || rect.y < 0f || rect.y > 1f)
            {
                result.Errors.Add($"elements[{index}] rect position must be normalized 0..1");
            }
            if (!(rect.w > 0f) || rect.w > 1f || !(rect.h > 0f) || rect.h > 1f)
            {
                result.Errors.Add($"elements[{index}] rect size must be normalized (0,1]");
            }
        }

        private static string FindCyclicHint(IntentElementData[] elements, Dictionary<string, int> hintToIndex)
        {
            var state = new int[elements.Length]; // 0 unvisited, 1 in-progress, 2 done

            string Visit(int index)
            {
                if (state[index] == 2) return null;
                if (state[index] == 1)
                {
                    return elements[index].clientHintId ?? $"elements[{index}]";
                }
                state[index] = 1;
                string parentHint = elements[index].parentClientHintId;
                if (!string.IsNullOrEmpty(parentHint) && hintToIndex.TryGetValue(parentHint, out int parentIndex))
                {
                    string found = Visit(parentIndex);
                    if (found != null) return found;
                }
                state[index] = 2;
                return null;
            }

            for (int i = 0; i < elements.Length; i++)
            {
                string found = Visit(i);
                if (found != null) return found;
            }
            return null;
        }
    }
}
