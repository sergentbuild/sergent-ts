import type { ModelMessages } from "../model-request/index.js";
import { compilePatch as compileDefaultPatch, createExecutionPlan } from "../operations/index.js";
import type {
  ExecutionPlan,
  Operation,
  OperationRegistry,
  Patch,
  PlanStep,
} from "../operations/index.js";
import type { ProposalSchema } from "../schema/index.js";
import type { Target } from "../scene/index.js";
import type { Intent, RunError, SceneIdentity, StopIntent } from "../values/index.js";

/** The trusted deterministic Intent Proposal used by pass-through mode. */
export interface PassThroughIntentProposal {
  readonly kind: "pass_through";
}

/** The one shared pass-through Intent proposal sentinel. */
export const PASS_THROUGH_INTENT_PROPOSAL: PassThroughIntentProposal = {
  kind: "pass_through",
};

/** Stable application context supplied to Recipe policy hooks. */
export interface RecipeContext<Scene, TargetValue extends Target> {
  readonly scene: Scene;
  readonly target: TargetValue;
  readonly mindBuf: string;
}

/** Recipe message context carrying the exact captured ProposalSchema. */
export interface RecipeMessageContext<Scene, TargetValue extends Target>
  extends RecipeContext<Scene, TargetValue> {
  readonly proposalSchema: ProposalSchema;
}

/** Application terminal data and metadata for a successful stop Intent. */
export interface StopTerminal<Data = unknown, Metadata = unknown> {
  readonly data: Data;
  readonly metadata: Metadata;
}

/** Acceptance from an application Recipe validation hook. */
export interface RecipeValidationAccepted {
  readonly ok: true;
}

/** Rejection from an application Recipe validation hook. */
export interface RecipeValidationRejected {
  readonly ok: false;
  readonly error: RunError;
}

/** The expected result of Recipe Intent or whole-Plan validation. */
export type RecipeValidationResult = RecipeValidationAccepted | RecipeValidationRejected;

/** Application policy for a run that can only derive a stop Intent. */
export interface IntentOnlyRecipe<
  Proposal,
  IntentValue extends StopIntent,
  Scene,
  TargetValue extends Target,
  TerminalData = unknown,
  TerminalMetadata = unknown,
> {
  readonly kind: "intent_only";
  readonly registry: null;
  readonly noTargetError: RunError;

  /** Authors only the portable messages for a model-backed Intent phase. */
  buildIntentMessages(context: RecipeMessageContext<Scene, TargetValue>): ModelMessages;

  /** Derives an application stop Intent from a typed proposal. */
  deriveIntent(proposal: Proposal, context: RecipeContext<Scene, TargetValue>): IntentValue;

  /** Checks independent application semantics of the derived Intent. */
  validateIntent(
    intent: IntentValue,
    context: RecipeContext<Scene, TargetValue>,
  ): RecipeValidationResult;

  /** Supplies bounded terminal application data for the successful stop. */
  stopTerminal(
    intent: IntentValue,
    context: RecipeContext<Scene, TargetValue>,
  ): StopTerminal<TerminalData, TerminalMetadata>;
}

/** Construction input for an Intent-Only application Recipe. */
export type IntentOnlyRecipeConfig<
  Proposal,
  IntentValue extends StopIntent,
  Scene,
  TargetValue extends Target,
  TerminalData,
  TerminalMetadata,
> = Omit<
  IntentOnlyRecipe<Proposal, IntentValue, Scene, TargetValue, TerminalData, TerminalMetadata>,
  "kind" | "registry"
>;

/** Application policy for a stop-or-continue run with a closed registry. */
export interface PlanCapableRecipe<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation = Operation,
  TerminalData = unknown,
  TerminalMetadata = unknown,
> {
  readonly kind: "plan_capable";
  readonly registry: OperationRegistry<OperationData, Scene, IntentValue, TargetValue>;
  readonly noTargetError: RunError;

  /** Authors only the portable messages for a model-backed Intent phase. */
  buildIntentMessages(context: RecipeMessageContext<Scene, TargetValue>): ModelMessages;

  /** Authors only the portable messages for the continuing Plan phase. */
  buildPlanMessages(
    intent: IntentValue,
    context: RecipeMessageContext<Scene, TargetValue>,
  ): ModelMessages;

  /** Derives an application Intent from one typed proposal. */
  deriveIntent(proposal: Proposal, context: RecipeContext<Scene, TargetValue>): IntentValue;

  /** Checks independent application semantics of the derived Intent. */
  validateIntent(
    intent: IntentValue,
    context: RecipeContext<Scene, TargetValue>,
  ): RecipeValidationResult;

  /** Derives a Scene-bound ExecutionPlan from decoded ordered steps. */
  derivePlan(
    base: SceneIdentity,
    intent: IntentValue,
    steps: readonly PlanStep<OperationData>[],
    context: RecipeContext<Scene, TargetValue>,
  ): ExecutionPlan<IntentValue, OperationData>;

  /** Checks ordering, interactions, budgets, and whole-Plan legality. */
  validatePlan(
    plan: ExecutionPlan<IntentValue, OperationData>,
    context: RecipeContext<Scene, TargetValue>,
  ): RecipeValidationResult;

  /** Compiles validated steps into one replayable isolated Patch. */
  compilePatch(plan: ExecutionPlan<IntentValue, OperationData>): Patch<OperationData>;

  /** Supplies bounded terminal application data for a successful stop. */
  stopTerminal(
    intent: IntentValue,
    context: RecipeContext<Scene, TargetValue>,
  ): StopTerminal<TerminalData, TerminalMetadata>;
}

/** Construction input for a Plan-capable application Recipe. */
export type PlanCapableRecipeConfig<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
  TerminalData,
  TerminalMetadata,
> = Omit<
  PlanCapableRecipe<
    Proposal,
    IntentValue,
    Scene,
    TargetValue,
    OperationData,
    TerminalData,
    TerminalMetadata
  >,
  "kind" | "derivePlan" | "compilePatch"
> & {
  readonly derivePlan?: PlanCapableRecipe<
    Proposal,
    IntentValue,
    Scene,
    TargetValue,
    OperationData,
    TerminalData,
    TerminalMetadata
  >["derivePlan"];
  readonly compilePatch?: PlanCapableRecipe<
    Proposal,
    IntentValue,
    Scene,
    TargetValue,
    OperationData,
    TerminalData,
    TerminalMetadata
  >["compilePatch"];
};

/** Returns the shared successful Recipe validation value. */
export function recipeValid(): RecipeValidationAccepted {
  return { ok: true };
}

/** Returns an expected Recipe validation rejection. */
export function recipeInvalid(error: RunError): RecipeValidationRejected {
  return { ok: false, error };
}

/** Constructs an Intent-Only Recipe that cannot enter a Plan phase. */
export function createIntentOnlyRecipe<
  Proposal,
  IntentValue extends StopIntent,
  Scene,
  TargetValue extends Target,
  TerminalData = unknown,
  TerminalMetadata = unknown,
>(
  config: IntentOnlyRecipeConfig<
    Proposal,
    IntentValue,
    Scene,
    TargetValue,
    TerminalData,
    TerminalMetadata
  >,
): IntentOnlyRecipe<Proposal, IntentValue, Scene, TargetValue, TerminalData, TerminalMetadata> {
  return { ...config, kind: "intent_only" as const, registry: null };
}

/** Constructs a Plan-capable Recipe with mechanical framework defaults. */
export function createPlanCapableRecipe<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation = Operation,
  TerminalData = unknown,
  TerminalMetadata = unknown,
>(
  config: PlanCapableRecipeConfig<
    Proposal,
    IntentValue,
    Scene,
    TargetValue,
    OperationData,
    TerminalData,
    TerminalMetadata
  >,
): PlanCapableRecipe<
  Proposal,
  IntentValue,
  Scene,
  TargetValue,
  OperationData,
  TerminalData,
  TerminalMetadata
> {
  const derivePlan =
    config.derivePlan ??
    ((base: SceneIdentity, intent: IntentValue, steps: readonly PlanStep<OperationData>[]) =>
      createExecutionPlan(base, intent, steps));
  const compilePatch = config.compilePatch ?? compileDefaultPatch;
  return {
    ...config,
    kind: "plan_capable" as const,
    derivePlan,
    compilePatch,
  };
}
