import { createProposalDefinition } from "../schema/index.js";
import type { ProposalDefinition, SchemaDecodeResult } from "../schema/index.js";
import { mintOperationId, schemaValidationError } from "../values/index.js";
import type { Intent } from "../values/index.js";
import { composePlanSchema } from "./composition.js";
import { operationDefinitionState } from "./definition.js";
import type {
  AdmissibilityContext,
  AdmissibilityResult,
  Operation,
  OperationDefinition,
  OperationDefinitionBase,
  PlanDecodeResult,
  PlanStep,
} from "./types.js";

/** Extracts the Operation union from a definition tuple. */
export type DefinitionOperation<Definition> =
  Definition extends OperationDefinition<
    infer OperationData,
    infer _Scene,
    infer _Intent,
    infer _Target
  >
    ? OperationData
    : never;

/** Extracts the Scene type from an Operation definition. */
type DefinitionScene<Definition> =
  Definition extends OperationDefinition<
    infer _Operation,
    infer Scene,
    infer _Intent,
    infer _Target
  >
    ? Scene
    : never;

/** Extracts the Intent type from an Operation definition. */
type DefinitionIntent<Definition> =
  Definition extends OperationDefinition<
    infer _Operation,
    infer _Scene,
    infer IntentValue,
    infer _Target
  >
    ? IntentValue
    : never;

/** Extracts the Target type from an Operation definition. */
type DefinitionTarget<Definition> =
  Definition extends OperationDefinition<
    infer _Operation,
    infer _Scene,
    infer _Intent,
    infer Target
  >
    ? Target
    : never;

/** Requires every tuple member to carry the first definition's exact context. */
type CommonRegistryDefinitions<Definitions extends readonly OperationDefinitionBase[]> =
  Definitions extends readonly [infer First extends OperationDefinitionBase, ...unknown[]]
    ? readonly OperationDefinition<
        Operation,
        DefinitionScene<First>,
        DefinitionIntent<First>,
        DefinitionTarget<First>
      >[]
    : never;

/** A nonempty closed Operation set and its exact Plan Proposal crossing. */
export interface OperationRegistry<
  OperationData extends Operation = Operation,
  Scene = unknown,
  IntentValue extends Intent = Intent,
  Target = unknown,
> {
  readonly definitions: readonly OperationDefinitionBase[];
  readonly max_operations: number | null;
  readonly plan_proposal: ProposalDefinition;

  /** Strictly decodes a complete model-proposed Operation sequence once. */
  decodePlan(value: unknown): PlanDecodeResult<OperationData>;

  /** Strictly decodes one registry-tied Operation replacement. */
  decodeOperation(expectedCall: string, value: unknown): SchemaDecodeResult<OperationData>;

  /** Runs the registered optional admissibility rule for one typed step. */
  checkAdmissibility(
    step: PlanStep<OperationData>,
    context: AdmissibilityContext<Scene, IntentValue, Target>,
  ): AdmissibilityResult;
}

/** Checks registry membership and its optional model-visible count maximum. */
function assertRegistryConstruction(
  definitions: readonly OperationDefinitionBase[],
  maxOperations: number | null,
): void {
  if (definitions.length === 0) throw new TypeError("Operation registry must be nonempty");
  if (maxOperations !== null && (!Number.isSafeInteger(maxOperations) || maxOperations < 1)) {
    throw new TypeError("Operation maximum must be a positive integer");
  }
  const calls = new Set<string>();
  for (const definition of definitions) {
    operationDefinitionState(definition);
    if (calls.has(definition.call)) {
      throw new TypeError(`Duplicate Operation call: ${definition.call}`);
    }
    calls.add(definition.call);
  }
}

/** Reads a potential replacement discriminator before exact registry decode. */
function untrustedCall(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("call" in value)) return null;
  return typeof value.call === "string" ? value.call : null;
}

/** Constructs one nonempty closed Operation registry. */
export function createOperationRegistry<
  const Definitions extends readonly OperationDefinitionBase[],
>(
  definitions: Definitions & CommonRegistryDefinitions<NoInfer<Definitions>>,
  maxOperations: number | null = null,
): OperationRegistry<
  DefinitionOperation<Definitions[number]>,
  DefinitionScene<Definitions[number]>,
  DefinitionIntent<Definitions[number]>,
  DefinitionTarget<Definitions[number]>
> {
  assertRegistryConstruction(definitions, maxOperations);
  const captured = [...definitions];
  const byCall = new Map<string, Definitions[number]>();
  for (const definition of definitions) byCall.set(definition.call, definition);
  const planSchema = composePlanSchema<DefinitionOperation<Definitions[number]>>(
    captured,
    maxOperations,
  );
  const planProposal = createProposalDefinition("PlanProposal", planSchema);
  return {
    definitions: captured,
    max_operations: maxOperations,
    plan_proposal: planProposal,
    decodePlan(value: unknown): PlanDecodeResult<DefinitionOperation<Definitions[number]>> {
      const decoded = planProposal.decode(value);
      if (!decoded.ok) return decoded;
      const steps = decoded.value.operations.map((operation) => ({
        op_id: mintOperationId(),
        operation,
      }));
      return { ok: true, steps };
    },
    decodeOperation(
      expectedCall: string,
      value: unknown,
    ): SchemaDecodeResult<DefinitionOperation<Definitions[number]>> {
      const call = untrustedCall(value);
      const definition = byCall.get(expectedCall);
      if (call !== expectedCall || definition === undefined) {
        return { ok: false, error: schemaValidationError("Unknown Operation call") };
      }
      const decoded = planProposal.decode({ operations: [value] });
      if (!decoded.ok) return decoded;
      return { ok: true, value: decoded.value.operations[0] };
    },
    checkAdmissibility(
      step: PlanStep<DefinitionOperation<Definitions[number]>>,
      context: AdmissibilityContext<
        DefinitionScene<Definitions[number]>,
        DefinitionIntent<Definitions[number]>,
        DefinitionTarget<Definitions[number]>
      >,
    ): AdmissibilityResult {
      const definition = byCall.get(step.operation.call);
      if (definition === undefined) {
        throw new TypeError("Typed Operation is not a member of its registry");
      }
      return operationDefinitionState(definition).checkAdmissibility(step.operation, context);
    },
  };
}
