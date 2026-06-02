import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Ajv, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { PlanningIntent } from "./types.js";

// schemas/ sits two levels above this module in both src/core and dist/core.
const SCHEMA_URL = new URL("../../schemas/planning-intent.schema.json", import.meta.url);

export const planningIntentSchema: Record<string, unknown> = JSON.parse(
  readFileSync(fileURLToPath(SCHEMA_URL), "utf8"),
) as Record<string, unknown>;

export const PLANNING_INTENT_SCHEMA_ID: string = planningIntentSchema["$id"] as string;
export const PLANNING_INTENT_VERSION: string = planningIntentSchema["version"] as string;

const ajv = new Ajv({ allErrors: true, strict: false });
// ajv-formats ships as CJS; under NodeNext its default import types resolve to the
// module namespace, so cast to the callable plugin shape (runtime value is correct).
(addFormats as unknown as (instance: Ajv) => void)(ajv);

const validator: ValidateFunction = ajv.compile(planningIntentSchema);

export interface SchemaValidationResult {
  ok: boolean;
  errors: string[];
}

/** Validate arbitrary data against the PlanningIntent JSON Schema. */
export function validatePlanningIntentSchema(data: unknown): SchemaValidationResult {
  const ok = validator(data) as boolean;
  if (ok) return { ok: true, errors: [] };
  const errors = (validator.errors ?? []).map((e) => {
    const path = e.instancePath || "(root)";
    return `${path} ${e.message ?? "is invalid"}`;
  });
  return { ok: false, errors };
}

/** Narrowing helper used by tool handlers. */
export function isPlanningIntent(data: unknown): data is PlanningIntent {
  return validatePlanningIntentSchema(data).ok;
}
