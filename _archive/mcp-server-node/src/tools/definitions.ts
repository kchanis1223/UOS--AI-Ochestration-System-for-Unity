import { validatePlanningIntentSchema } from "../core/schema.js";
import { validateIntentTree } from "../core/intentValidation.js";
import type { PlanningIntent } from "../core/types.js";
import {
  listPlanningMaterials,
  readPlanningMaterial,
  pptxToImagesNotImplemented,
  preprocessImageNotImplemented,
} from "./planningMaterials.js";

export interface ToolPreflightResult {
  ok: boolean;
  errors: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /**
   * Deterministic, transport-free validation applied before proxying to Unity.
   * Returns ok=false with errors to short-circuit a bad call without a round-trip.
   */
  preflight?: (args: Record<string, unknown>) => ToolPreflightResult;
  /**
   * Sidecar-local handler. When defined, dispatch runs this INSTEAD of proxying
   * to Unity (filesystem-only tools that don't need the Editor).
   */
  localHandler?: (args: Record<string, unknown>) => Promise<unknown>;
}

const elementInputSchema: Record<string, unknown> = {
  type: "object",
  required: ["type", "rect"],
  properties: {
    clientHintId: { type: "string", description: "Advisory client id; authoritative only for intra-call parent linkage." },
    parentClientHintId: { type: "string", description: "clientHintId of the parent element within this same intent." },
    type: {
      type: "string",
      enum: ["Panel", "Text", "Button", "Image", "InputField", "Toggle", "Slider", "ScrollView", "Dropdown"],
    },
    rect: {
      type: "object",
      required: ["x", "y", "w", "h"],
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        w: { type: "number" },
        h: { type: "number" },
      },
    },
    anchor: { type: "string" },
    props: { type: "object" },
  },
};

const planningIntentInputSchema: Record<string, unknown> = {
  type: "object",
  required: ["version", "screenName", "referenceCanvas", "elements"],
  properties: {
    version: { type: "string", const: "1.0.0" },
    screenName: { type: "string" },
    referenceCanvas: {
      type: "object",
      required: ["width", "height"],
      properties: { width: { type: "number" }, height: { type: "number" } },
    },
    elements: { type: "array", items: elementInputSchema },
  },
};

function preflightCreateUiScreen(args: Record<string, unknown>): ToolPreflightResult {
  const intent = args["intent"];
  const schemaResult = validatePlanningIntentSchema(intent);
  if (!schemaResult.ok) {
    return { ok: false, errors: schemaResult.errors.map((e) => `schema: ${e}`) };
  }
  const treeResult = validateIntentTree(intent as PlanningIntent);
  if (!treeResult.ok) {
    return { ok: false, errors: treeResult.errors.map((e) => `tree: ${e}`) };
  }
  return { ok: true, errors: [] };
}

/**
 * The full v1 tool surface. Each tool proxies to the Unity Editor over the bridge;
 * create_ui_screen additionally runs deterministic preflight validation here.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "list_planning_materials",
    description:
      "List available planning materials (mockup images / slide decks) the client LLM can read and interpret. Scans $UNITY_MCP_MATERIALS_DIR (or cwd) when 'dir' is omitted.",
    inputSchema: {
      type: "object",
      properties: { dir: { type: "string", description: "Optional directory to scan." } },
    },
    localHandler: listPlanningMaterials,
  },
  {
    name: "read_planning_material",
    description:
      "Return a planning material as an MCP resource (file URI for large files; size-capped base64 fallback otherwise). The client LLM performs the multimodal vision; the server never interprets images.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
    },
    localHandler: readPlanningMaterial,
  },
  {
    name: "pptx_to_images",
    description: "Convert a .pptx deck into an array of per-slide images. NOT IMPLEMENTED in v1 (no bundled libreoffice/poppler); pre-render slides on disk and use list_planning_materials instead.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
    },
    localHandler: pptxToImagesNotImplemented,
  },
  {
    name: "preprocess_image",
    description: "Apply preprocessing ops (e.g. downscale, crop). NOT IMPLEMENTED in v1 (no bundled sharp/jimp); pre-process on disk before read_planning_material.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string" },
        ops: { type: "array", items: { type: "object" } },
      },
    },
    localHandler: preprocessImageNotImplemented,
  },
  {
    name: "create_ui_screen",
    description:
      "Generate a Unity UI screen (Canvas + element tree) from a PlanningIntent. Returns { screenId, elements: [{ clientHintId, elementId }] } with server-minted canonical ids. clientHintId is advisory and authoritative only for intra-call parent linkage.",
    inputSchema: {
      type: "object",
      required: ["intent"],
      properties: { intent: planningIntentInputSchema },
    },
    preflight: preflightCreateUiScreen,
  },
  {
    name: "add_ui_element",
    description: "Add a single element to an existing screen. Returns { elementId } (server-minted canonical id).",
    inputSchema: {
      type: "object",
      required: ["screenId", "element"],
      properties: { screenId: { type: "string" }, element: elementInputSchema },
    },
  },
  {
    name: "create_screen_transition",
    description: "Create a navigation transition between two screens (panel toggle via ScreenFlowController).",
    inputSchema: {
      type: "object",
      required: ["fromId", "toId", "trigger"],
      properties: {
        fromId: { type: "string" },
        toId: { type: "string" },
        trigger: { type: "string", description: "e.g. a button elementId or named event." },
      },
    },
  },
  {
    name: "update_ui_element",
    description: "Update properties of an existing element by its server-minted canonical elementId.",
    inputSchema: {
      type: "object",
      required: ["elementId"],
      properties: {
        elementId: { type: "string" },
        props: { type: "object" },
        rect: { type: "object" },
        anchor: { type: "string" },
      },
    },
  },
  {
    name: "move_ui_element",
    description: "Move/resize an existing element by its canonical elementId. rect is normalized 0..1.",
    inputSchema: {
      type: "object",
      required: ["elementId", "rect"],
      properties: {
        elementId: { type: "string" },
        rect: {
          type: "object",
          required: ["x", "y", "w", "h"],
          properties: { x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } },
        },
        anchor: { type: "string" },
      },
    },
  },
  {
    name: "delete_ui_element",
    description: "Delete an element by its canonical elementId.",
    inputSchema: {
      type: "object",
      required: ["elementId"],
      properties: { elementId: { type: "string" } },
    },
  },
  {
    name: "list_screens",
    description: "List the screens currently present in the Unity scene.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_scene_hierarchy",
    description: "Return the GameObject hierarchy of a screen (or the whole scene) for client feedback.",
    inputSchema: {
      type: "object",
      properties: { screenId: { type: "string" } },
    },
  },
  {
    name: "capture_preview",
    description: "Capture a thumbnail preview of a screen (size-capped, mirrors read input caps).",
    inputSchema: {
      type: "object",
      required: ["screenId"],
      properties: { screenId: { type: "string" } },
    },
  },
];

export function toolByName(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}
