import { z } from "zod";

export const ElementTypes = [
  "Panel",
  "Text",
  "Button",
  "Image",
  "InputField",
  "Toggle",
  "Slider",
  "ScrollView",
  "Dropdown",
  "Video",
] as const;

export const RectSchema = z.object({
  x: z.number().min(0).max(1).describe("Normalized x (0..1) relative to referenceCanvas, top-left origin."),
  y: z.number().min(0).max(1).describe("Normalized y (0..1) relative to referenceCanvas, top-left origin."),
  w: z.number().gt(0).max(1).describe("Normalized width (0,1] relative to referenceCanvas."),
  h: z.number().gt(0).max(1).describe("Normalized height (0,1] relative to referenceCanvas."),
}).strict();

export const ElementTypeEnum = z.enum(ElementTypes);

export const ElementPropsSchema = z.object({
  text: z.string().optional().describe("Text content / Button label / InputField placeholder / ScrollView body text."),
  placeholder: z.string().optional().describe("InputField placeholder text. If omitted, InputField still accepts props.text as the legacy placeholder."),
  inputText: z.string().optional().describe("InputField current text value."),
  color: z.string().optional().describe("Hex color, '#RRGGBB' or '#RRGGBBAA'."),
  fontSize: z.number().int().nonnegative().optional().describe("Text font size in pt (0 = leave default)."),
  fontStyle: z.string().optional().describe("Unity FontStyle: Normal, Bold, Italic, or BoldAndItalic."),
  sprite: z.string().optional().describe("Sprite asset path resolvable by AssetDatabase, e.g. 'Assets/UI/btn.png'."),
  video: z.string().optional().describe("VideoClip asset path resolvable by AssetDatabase, e.g. 'Assets/UOS/Videos/intro.mp4'."),
  align: z.string().optional().describe("Alignment: Left / Center / Right / TopLeft / MiddleCenter / etc. (default MiddleCenter)."),
  value: z.number().finite().optional().describe("Numeric control value: Slider value or Dropdown selected option index."),
  hasValue: z.boolean().optional().describe("Internal bridge compatibility flag; usually omit and provide value instead."),
  minValue: z.number().finite().optional().describe("Slider minimum value."),
  hasMinValue: z.boolean().optional().describe("Internal bridge compatibility flag; usually omit and provide minValue instead."),
  maxValue: z.number().finite().optional().describe("Slider maximum value."),
  hasMaxValue: z.boolean().optional().describe("Internal bridge compatibility flag; usually omit and provide maxValue instead."),
  isOn: z.boolean().optional().describe("Toggle checked state."),
  hasIsOn: z.boolean().optional().describe("Internal bridge compatibility flag; usually omit and provide isOn instead."),
  interactable: z.boolean().optional().describe("Selectable control interactable state for Button/InputField/Toggle/Slider/Dropdown."),
  hasInteractable: z.boolean().optional().describe("Internal bridge compatibility flag; usually omit and provide interactable instead."),
  options: z.array(z.string()).max(200).optional().describe("Dropdown option labels, in order."),
  loop: z.boolean().optional().describe("Video playback loop flag."),
  hasLoop: z.boolean().optional().describe("Internal bridge compatibility flag; usually omit and provide loop instead."),
  playOnAwake: z.boolean().optional().describe("Video playback starts automatically when the screen GameObject becomes active."),
  hasPlayOnAwake: z.boolean().optional().describe("Internal bridge compatibility flag; usually omit and provide playOnAwake instead."),
  muted: z.boolean().optional().describe("Video audio muted flag."),
  hasMuted: z.boolean().optional().describe("Internal bridge compatibility flag; usually omit and provide muted instead."),
}).strict().optional();

export const IntentElementSchema = z.object({
  clientHintId: z.string().describe("Advisory client id; authoritative only for intra-call parent linkage.").optional(),
  parentClientHintId: z.string().describe("clientHintId of the parent element within this same intent.").optional(),
  type: ElementTypeEnum,
  rect: RectSchema,
  anchor: z.string().optional(),
  props: ElementPropsSchema,
}).strict();

export const AddElementSchema = IntentElementSchema.extend({
  parentClientHintId: z.string()
    .optional()
    .describe("Invalid for add_ui_element; parentClientHintId only works inside create_ui_screen. Use parentElementId instead."),
  parentElementId: z.string()
    .optional()
    .describe("Canonical existing parent element id. Use to add this element under an existing generated element."),
});

export const PlanningIntentSchema = z.object({
  version: z.literal("1.0.0"),
  screenName: z.string().min(1),
  referenceCanvas: z.object({
    width: z.number().gt(0),
    height: z.number().gt(0),
  }).strict(),
  elements: z.array(IntentElementSchema),
}).strict();

export type PlanningIntent = z.infer<typeof PlanningIntentSchema>;
export type IntentElement = z.infer<typeof IntentElementSchema>;
export type AddElement = z.infer<typeof AddElementSchema>;
export type ElementProps = NonNullable<z.infer<typeof ElementPropsSchema>>;

export type BridgeElementProps = ElementProps & {
  hasValue?: boolean;
  hasMinValue?: boolean;
  hasMaxValue?: boolean;
  hasIsOn?: boolean;
  hasInteractable?: boolean;
  hasLoop?: boolean;
  hasPlayOnAwake?: boolean;
  hasMuted?: boolean;
};

export interface PlanningIntentValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  intent?: PlanningIntent;
}

export interface AddElementValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  element?: AddElement;
}

export function normalizeElementPropsForBridge(props: ElementProps | undefined): BridgeElementProps | undefined {
  if (props === undefined) return undefined;
  const normalized: BridgeElementProps = { ...props };
  if (props.value !== undefined) normalized.hasValue = true;
  if (props.minValue !== undefined) normalized.hasMinValue = true;
  if (props.maxValue !== undefined) normalized.hasMaxValue = true;
  if (props.isOn !== undefined) normalized.hasIsOn = true;
  if (props.interactable !== undefined) normalized.hasInteractable = true;
  if (props.loop !== undefined) normalized.hasLoop = true;
  if (props.playOnAwake !== undefined) normalized.hasPlayOnAwake = true;
  if (props.muted !== undefined) normalized.hasMuted = true;
  return normalized;
}

export function normalizeIntentForBridge(intent: PlanningIntent): PlanningIntent {
  return {
    ...intent,
    elements: intent.elements.map((element) => ({
      ...element,
      props: normalizeElementPropsForBridge(element.props),
    })),
  } as PlanningIntent;
}

export function normalizeAddElementForBridge(element: AddElement): AddElement {
  return {
    ...element,
    props: normalizeElementPropsForBridge(element.props),
  } as AddElement;
}

function formatPath(path: Array<string | number>): string {
  if (path.length === 0) return "intent";
  return path.reduce<string>((acc, part) => {
    if (typeof part === "number") return `${acc}[${part}]`;
    return acc.length === 0 ? part : `${acc}.${part}`;
  }, "");
}

function formatIssue(issue: z.ZodIssue): string {
  return `${formatPath(issue.path)}: ${issue.message}`;
}

function formatNumber(value: number): string {
  return Number.parseFloat(value.toFixed(6)).toString();
}

export function validateIntentTree(intent: PlanningIntent): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const idToIndex = new Map<string, number>();

  intent.elements.forEach((el, index) => {
    if (el.clientHintId === undefined) return;
    if (ids.has(el.clientHintId)) {
      errors.push(`duplicate clientHintId "${el.clientHintId}"`);
      return;
    }
    ids.add(el.clientHintId);
    idToIndex.set(el.clientHintId, index);
  });

  intent.elements.forEach((el, index) => {
    if (el.parentClientHintId === undefined) return;
    if (el.clientHintId !== undefined && el.parentClientHintId === el.clientHintId) {
      errors.push(`elements[${index}] ("${el.clientHintId}") references itself as parent`);
      return;
    }
    if (!ids.has(el.parentClientHintId)) {
      errors.push(`elements[${index}] parentClientHintId "${el.parentClientHintId}" does not match any clientHintId`);
    }
  });

  if (errors.length === 0) {
    const cyclic = findCyclicHint(intent, idToIndex);
    if (cyclic !== undefined) {
      errors.push(`cycle detected in parent references involving "${cyclic}"`);
    }
  }

  return errors;
}

export function validateIntentWarnings(intent: PlanningIntent): string[] {
  const warnings: string[] = [];
  if (intent.elements.length === 0) {
    warnings.push("intent has no elements; create_ui_screen will create an empty screen");
  }
  intent.elements.forEach((el, index) => {
    if (el.rect.x + el.rect.w > 1) {
      warnings.push(`elements[${index}] rect extends past the right edge; x + w is ${formatNumber(el.rect.x + el.rect.w)}`);
    }
    if (el.rect.y + el.rect.h > 1) {
      warnings.push(`elements[${index}] rect extends past the bottom edge; y + h is ${formatNumber(el.rect.y + el.rect.h)}`);
    }
    if (el.props?.sprite !== undefined && !el.props.sprite.startsWith("Assets/")) {
      warnings.push(`elements[${index}] props.sprite should usually be a Unity asset path under Assets/`);
    }
    if (el.type === "Video" && el.props?.video === undefined) {
      warnings.push(`elements[${index}] Video element should provide props.video with a Unity asset path`);
    }
    if (el.props?.video !== undefined && !el.props.video.startsWith("Assets/")) {
      warnings.push(`elements[${index}] props.video should usually be a Unity asset path under Assets/`);
    }
  });
  return warnings;
}

export function validatePlanningIntent(input: unknown): PlanningIntentValidation {
  const parsed = PlanningIntentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(formatIssue),
      warnings: [],
    };
  }

  const errors = validateIntentTree(parsed.data);
  const warnings = validateIntentWarnings(parsed.data);
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    intent: parsed.data,
  };
}

export function validateAddElement(input: unknown): AddElementValidation {
  const parsed = AddElementSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(formatIssue),
      warnings: [],
    };
  }

  const errors: string[] = [];
  if (parsed.data.parentClientHintId !== undefined) {
    errors.push("element.parentClientHintId is only valid inside create_ui_screen; use element.parentElementId for follow-up add_ui_element calls");
  }

  const warnings: string[] = [];
  if (parsed.data.rect.x + parsed.data.rect.w > 1) {
    warnings.push(`element rect extends past the right edge; x + w is ${formatNumber(parsed.data.rect.x + parsed.data.rect.w)}`);
  }
  if (parsed.data.rect.y + parsed.data.rect.h > 1) {
    warnings.push(`element rect extends past the bottom edge; y + h is ${formatNumber(parsed.data.rect.y + parsed.data.rect.h)}`);
  }
  if (parsed.data.props?.sprite !== undefined && !parsed.data.props.sprite.startsWith("Assets/")) {
    warnings.push("element.props.sprite should usually be a Unity asset path under Assets/");
  }
  if (parsed.data.type === "Video" && parsed.data.props?.video === undefined) {
    warnings.push("Video element should provide props.video with a Unity asset path");
  }
  if (parsed.data.props?.video !== undefined && !parsed.data.props.video.startsWith("Assets/")) {
    warnings.push("element.props.video should usually be a Unity asset path under Assets/");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    element: parsed.data,
  };
}

function findCyclicHint(intent: PlanningIntent, idToIndex: Map<string, number>): string | undefined {
  const state = new Array(intent.elements.length).fill(0) as number[];

  function visit(index: number): string | undefined {
    if (state[index] === 2) return undefined;
    if (state[index] === 1) return intent.elements[index]?.clientHintId ?? `elements[${index}]`;
    state[index] = 1;

    const parentHint = intent.elements[index]?.parentClientHintId;
    if (parentHint !== undefined) {
      const parentIndex = idToIndex.get(parentHint);
      if (parentIndex !== undefined) {
        const found = visit(parentIndex);
        if (found !== undefined) return found;
      }
    }

    state[index] = 2;
    return undefined;
  }

  for (let i = 0; i < intent.elements.length; i++) {
    const found = visit(i);
    if (found !== undefined) return found;
  }
  return undefined;
}
