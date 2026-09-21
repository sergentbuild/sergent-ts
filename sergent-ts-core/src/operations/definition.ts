import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { TSchema, TUnsafe } from "typebox";

import { assertCanonicalSchema } from "../schema/index.js";
import type { CanonicalObjectSchema, SchemaDecodeResult } from "../schema/index.js";
import { schemaValidationError } from "../values/index.js";
import type { Intent } from "../values/index.js";
import type {
  AdmissibilityResult,
  Operation,
  OperationAdmissibility,
  OperationDefinition,
  OperationDefinitionBase,
  OperationValue,
} from "./types.js";
import { operationDefinitionBrand } from "./types.js";

/** Erased private mechanics retained for one constructed definition. */
export interface OperationDefinitionState {
  readonly operationSchema: CanonicalObjectSchema;
  readonly checkAdmissibility: OperationAdmissibility<Operation, unknown, Intent, unknown>;
}

/** Private mechanics keyed by the public constructed definition. */
const states = new WeakMap<object, OperationDefinitionState>();

/** Builds one closed fixed-discriminator Operation schema. */
function buildOperationSchema<Call extends string, Schema extends TSchema>(
  call: Call,
  operands: Schema & CanonicalObjectSchema,
): TUnsafe<OperationValue<Call, Schema>> & CanonicalObjectSchema {
  const properties = { call: Type.Enum([call]), ...operands.properties };
  const options: Record<string, unknown> = { additionalProperties: false };
  if (operands.description !== undefined) options.description = operands.description;
  if (operands.$defs !== undefined) options.$defs = operands.$defs;
  const operationSchema = Type.Unsafe<OperationValue<Call, Schema>>(
    Type.Object(properties, options),
  );
  assertCanonicalSchema(operationSchema);
  return operationSchema;
}

/** Accepts an Operation that has no application-specific precondition. */
function acceptOperation(): AdmissibilityResult {
  return { ok: true };
}

/** Constructs one registered TypeBox Operation definition. */
export function defineOperation<
  const Call extends string,
  const Schema extends TSchema,
  Scene = unknown,
  IntentValue extends Intent = Intent,
  Target = unknown,
>(
  call: Call,
  operandSchema: Schema,
  admissibility: OperationAdmissibility<
    OperationValue<Call, Schema>,
    Scene,
    IntentValue,
    Target
  > | null = null,
): OperationDefinition<OperationValue<Call, Schema>, Scene, IntentValue, Target> {
  if (call.length === 0) throw new TypeError("Operation call must be nonempty");
  assertCanonicalSchema(operandSchema);
  if ("call" in operandSchema.properties) {
    throw new TypeError("Operation operand schema must not declare the reserved call field");
  }
  const operationSchema = buildOperationSchema(call, operandSchema);
  const validator = Compile(operationSchema);
  const checkAdmissibility: OperationAdmissibility<Operation, unknown, Intent, unknown> =
    admissibility ?? acceptOperation;
  const definition: OperationDefinition<
    OperationValue<Call, Schema>,
    Scene,
    IntentValue,
    Target
  > = {
    call,
    operand_schema: operandSchema,
    [operationDefinitionBrand]: true as const,
    decode(value: unknown): SchemaDecodeResult<OperationValue<Call, Schema>> {
      return validator.Check(value)
        ? { ok: true, value }
        : { ok: false, error: schemaValidationError("Operation failed strict schema validation") };
    },
    checkAdmissibility,
  };
  states.set(definition, { operationSchema, checkAdmissibility });
  return definition;
}

/** Returns private mechanics for a factory-constructed definition. */
export function operationDefinitionState(
  definition: OperationDefinitionBase,
): OperationDefinitionState {
  const state = states.get(definition);
  if (state === undefined) {
    throw new TypeError("Operation definitions must be created by defineOperation");
  }
  return state;
}
