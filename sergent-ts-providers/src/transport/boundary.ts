import type { ModelTokens, TSchema } from "sergent-ts-core";

/** Empty index-signature witness used only for SDK schema type bridges. */
const SDK_SCHEMA_INDEX: Readonly<Record<string, never>> = {};

/** Object-shaped record narrowed from one external system value. */
export type ExternalObject = Record<string, unknown>;

/** Narrows one external value to a non-null, non-array object. */
export function isExternalObject(value: unknown): value is ExternalObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns true only for one valid provider-reported token direction. */
export function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Builds one token mapping from admitted counts without inventing missing directions. */
export function reportedTokenCounts(
  input: number | null,
  output: number | null,
): ModelTokens | null {
  if (input === null && output === null) return null;
  return {
    ...(input === null ? {} : { input }),
    ...(output === null ? {} : { output }),
  };
}

/** Bridges the canonical schema to an SDK record type without replacing it. */
export function sdkSchemaRecord(schema: TSchema): Record<string, unknown> {
  return Object.assign(schema, SDK_SCHEMA_INDEX);
}
