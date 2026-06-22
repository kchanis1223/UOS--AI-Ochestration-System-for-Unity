import { z } from "zod";

export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const SceneTransformSchema = z.object({
  position: Vec3Schema.optional().describe("Local position in Unity units."),
  rotation: Vec3Schema.optional().describe("Local Euler rotation in degrees."),
  scale: Vec3Schema.optional().describe("Local scale."),
});

export const SceneObjectTypeSchema = z.string().optional().describe(
  "Object type: Empty, Cube, Sphere, Capsule, Cylinder, Plane, Quad, Camera, PointLight, DirectionalLight, or SpotLight.",
);

export interface SceneObjectData {
  objectId?: string;
  name?: string;
  type?: string;
  path?: string;
  parentObjectId?: string;
  active?: boolean;
  transform?: {
    position?: { x?: number; y?: number; z?: number };
    rotation?: { x?: number; y?: number; z?: number };
    scale?: { x?: number; y?: number; z?: number };
  };
  components?: string[];
}

export function summarizeSceneObject(data: SceneObjectData): string {
  const id = stringValue(data.objectId) ?? "(no object id)";
  const name = stringValue(data.name) ?? "(unnamed)";
  const type = stringValue(data.type) ?? "(unknown)";
  const path = stringValue(data.path);
  const parent = stringValue(data.parentObjectId);
  const active = data.active === false ? " inactive" : data.active === true ? " active" : "";
  return [
    `${id} type=${type} name="${name}"${active}`,
    parent !== undefined ? `parent=${parent}` : undefined,
    path !== undefined ? `path=${path}` : undefined,
    transformSummary(data.transform),
  ].filter((part): part is string => part !== undefined).join(" ");
}

export function summarizeSceneObjects(objects: SceneObjectData[]): string {
  if (objects.length === 0) return "No UOS-created scene objects found.";
  return `Found ${objects.length} UOS-created scene object(s):\n` +
    objects.slice(0, 80).map((object) => `  - ${summarizeSceneObject(object)}`).join("\n") +
    (objects.length > 80 ? `\n... ${objects.length - 80} more object(s) omitted.` : "");
}

function transformSummary(transform: SceneObjectData["transform"]): string | undefined {
  if (transform === undefined || transform === null) return undefined;
  const parts = [
    vecSummary("pos", transform.position),
    vecSummary("rot", transform.rotation),
    vecSummary("scale", transform.scale),
  ].filter((part): part is string => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

function vecSummary(label: string, value: { x?: number; y?: number; z?: number } | undefined): string | undefined {
  if (value === undefined) return undefined;
  const x = numberValue(value.x);
  const y = numberValue(value.y);
  const z = numberValue(value.z);
  if (x === undefined || y === undefined || z === undefined) return undefined;
  return `${label}=(${fmt(x)},${fmt(y)},${fmt(z)})`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
