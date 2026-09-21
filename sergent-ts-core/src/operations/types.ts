import type { Static, TSchema } from "typebox";

import type {
  Intent,
  OperationId,
  RunError,
  SceneIdentity,
  ValidationIssue,
} from "../values/index.js";

/** Private construction proof for operation definitions. */
export const operationDefinitionBrand: unique symbol = Symbol("OperationDefinition");

/** Private Operation type carrier for definition inference. */
declare const operationType: unique symbol;

/** Private Scene type carrier for definition inference. */
declare const sceneType: unique symbol;

/** Private Intent type carrier for definition inference. */
declare const intentType: unique symbol;

/** Private Target type carrier for definition inference. */
declare const targetType: unique symbol;

/** Private invariant registry-context carrier. */
declare const registryContextType: unique symbol;

/** Readonly model-visible Operation data with a fixed call discriminator. */
export type Operation = Readonly<{ readonly call: string }>;

/** The static Operation authored by one call and TypeBox operand schema. */
export type OperationValue<Call extends string, Schema extends TSchema> = Readonly<
  Static<Schema> & { readonly call: Call }
>;

/** Stable context supplied to one Operation admissibility decision. */
export interface AdmissibilityContext<Scene, IntentValue extends Intent, Target> {
  readonly scene: Scene;
  readonly intent: IntentValue;
  readonly target: Target;
}

/** Acceptance from an Operation admissibility hook. */
export interface AdmissibilityAccepted {
  readonly ok: true;
}

/** Rejection from an Operation admissibility hook. */
export interface AdmissibilityRejected {
  readonly ok: false;
  readonly issue: ValidationIssue;
}

/** The expected result of one Operation admissibility decision. */
export type AdmissibilityResult = AdmissibilityAccepted | AdmissibilityRejected;

/** A synchronous read-only Operation admissibility hook. */
export type OperationAdmissibility<OperationData, Scene, IntentValue extends Intent, Target> = {
  bivarianceHack(
    operation: OperationData,
    context: AdmissibilityContext<Scene, IntentValue, Target>,
  ): AdmissibilityResult;
}["bivarianceHack"];

/** Invariant proof that every definition in one registry shares a context. */
interface RegistryContextProof<Scene, IntentValue extends Intent, Target> {
  readonly scene: (value: Scene) => Scene;
  readonly intent: (value: IntentValue) => IntentValue;
  readonly target: (value: Target) => Target;
}

/** Context-erased Operation definition mechanics used inside the unit. */
export interface OperationDefinitionBase {
  readonly call: string;
  readonly operand_schema: TSchema;
  readonly [operationDefinitionBrand]: true;

  /** Strictly decodes one untrusted fixed-call Operation. */
  decode(value: unknown): import("../schema/index.js").SchemaDecodeResult<Operation>;

  /** Runs one definition after registry context compatibility is proven. */
  readonly checkAdmissibility: OperationAdmissibility<Operation, unknown, Intent, unknown>;
}

/** One TypeBox-authored registered Operation contract. */
export interface OperationDefinition<
  OperationData extends Operation = Operation,
  Scene = unknown,
  IntentValue extends Intent = Intent,
  Target = unknown,
> extends OperationDefinitionBase {
  readonly [operationType]?: OperationData;
  readonly [sceneType]?: Scene;
  readonly [intentType]?: IntentValue;
  readonly [targetType]?: Target;
  readonly [registryContextType]?: RegistryContextProof<Scene, IntentValue, Target>;

  /** Strictly decodes one untrusted value against this fixed call. */
  decode(value: unknown): import("../schema/index.js").SchemaDecodeResult<OperationData>;

  /** Runs the optional deterministic admissibility rule. */
  readonly checkAdmissibility: OperationAdmissibility<OperationData, Scene, IntentValue, Target>;
}

/** One framework-identified step in a validated Plan or Patch. */
export interface PlanStep<OperationData = Operation> {
  readonly op_id: OperationId;
  readonly operation: OperationData;
}

/** A typed Operation script bound to one Scene and Intent. */
export interface ExecutionPlan<IntentValue extends Intent = Intent, OperationData = Operation> {
  readonly base: SceneIdentity;
  readonly intent: IntentValue;
  readonly steps: readonly PlanStep<OperationData>[];
}

/** An isolated ordered, replayable Operation sequence bound to its base Scene. */
export interface Patch<OperationData = Operation> {
  readonly base: SceneIdentity;
  readonly steps: readonly PlanStep<OperationData>[];
}

/** A successful Plan Proposal decode with framework-assigned identities. */
export interface PlanDecodeSuccess<OperationData> {
  readonly ok: true;
  readonly steps: readonly PlanStep<OperationData>[];
}

/** A failed Plan Proposal decode at the model-output boundary. */
export interface PlanDecodeFailure {
  readonly ok: false;
  readonly error: RunError;
}

/** The strict result of decoding a model-proposed Operation sequence. */
export type PlanDecodeResult<OperationData> = PlanDecodeSuccess<OperationData> | PlanDecodeFailure;

/** Returns the shared successful admissibility value. */
export function admissible(): AdmissibilityAccepted {
  return { ok: true };
}

/** Returns an admissibility rejection without framework correlation. */
export function inadmissible(issue: ValidationIssue): AdmissibilityRejected {
  return { ok: false, issue };
}
