export type Anchor =
  | "TopLeft" | "TopCenter" | "TopRight"
  | "MiddleLeft" | "MiddleCenter" | "MiddleRight"
  | "BottomLeft" | "BottomCenter" | "BottomRight"
  | "Stretch";

export type ElementType =
  | "Panel" | "Text" | "Button" | "Image" | "InputField"
  | "Toggle" | "Slider" | "ScrollView" | "Dropdown";

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReferenceCanvas {
  width: number;
  height: number;
}

export interface IntentElement {
  clientHintId?: string;
  parentClientHintId?: string;
  type: ElementType;
  rect: NormRect;
  anchor?: Anchor;
  props?: Record<string, unknown>;
}

export interface PlanningIntent {
  version: string;
  screenName: string;
  referenceCanvas: ReferenceCanvas;
  elements: IntentElement[];
}
