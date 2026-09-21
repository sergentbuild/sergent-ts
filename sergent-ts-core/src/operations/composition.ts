import { Type } from "typebox";
import type { TSchema, TUnsafe } from "typebox";

import { assertCanonicalSchema } from "../schema/index.js";
import type { CanonicalObjectSchema } from "../schema/index.js";
import type { Operation, OperationDefinitionBase } from "./types.js";
import { operationDefinitionState } from "./definition.js";

/** Enumerable JSON Schema data used for derived composition. */
type SchemaRecord = Record<string, unknown>;

/** Returns true for a non-array object. */
function isRecord(value: unknown): value is SchemaRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Compares two schema values without treating object key order as identity. */
function schemasEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => schemasEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  if (!schemasEqual(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) => schemasEqual(left[key], right[key]));
}

/** Merges equal shared definitions and rejects conflicting names. */
function mergeDefinitions(
  definitions: readonly OperationDefinitionBase[],
): Record<string, TSchema> {
  const merged = new Map<string, TSchema>();
  for (const definition of definitions) {
    const schema = operationDefinitionState(definition).operationSchema;
    const local = schema.$defs;
    if (local === undefined) continue;
    for (const [name, value] of Object.entries(local)) {
      const prior = merged.get(name);
      if (merged.has(name) && !schemasEqual(prior, value)) {
        throw new TypeError(`Conflicting schema definition: ${name}`);
      }
      merged.set(name, value);
    }
  }
  return Object.fromEntries(merged);
}

/** Derives a Plan branch without retaining a branch-local definitions table. */
function planBranch(definition: OperationDefinitionBase): TSchema {
  const schema = operationDefinitionState(definition).operationSchema;
  const options: Record<string, unknown> = { additionalProperties: false };
  if (typeof schema.description === "string") options.description = schema.description;
  return Type.Object(schema.properties, options);
}

/** The strictly typed nonempty operations envelope decoded at the Plan boundary. */
export interface PlanProposalValue<OperationData extends Operation> {
  readonly operations: readonly [OperationData, ...OperationData[]];
}

/** Composes the exact closed model-facing PlanProposal schema. */
export function composePlanSchema<OperationData extends Operation>(
  definitions: readonly OperationDefinitionBase[],
  maxOperations: number | null,
): TUnsafe<PlanProposalValue<OperationData>> & CanonicalObjectSchema {
  const branches = definitions.map(planBranch);
  const arrayOptions: Record<string, unknown> = { minItems: 1 };
  if (maxOperations !== null) arrayOptions.maxItems = maxOperations;
  const properties = {
    operations: Type.Array(Type.Union(branches), arrayOptions),
  };
  const merged = mergeDefinitions(definitions);
  const options: Record<string, unknown> = { additionalProperties: false };
  if (Object.keys(merged).length > 0) options.$defs = merged;
  const schema = Type.Unsafe<PlanProposalValue<OperationData>>(Type.Object(properties, options));
  assertCanonicalSchema(schema);
  return schema;
}
