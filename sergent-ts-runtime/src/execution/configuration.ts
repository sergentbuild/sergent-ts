import { PASS_THROUGH_INTENT_PROPOSAL } from "sergent-ts-core";
import type {
  Intent,
  IntentOnlyRecipe,
  ModelClient,
  ModelRequest,
  ModelSettings,
  Operation,
  OperationRegistry,
  PassThroughIntentProposal,
  PlanCapableRecipe,
  ProposalDefinition,
  ProposalSchema,
  RecipeMessageContext,
  SceneActions,
  SchemaDecodeResult,
  StopIntent,
  Target,
} from "sergent-ts-core";
import type { RunObserver } from "sergent-ts-observability";
import { createIntentOnlyConfiguredRun, createPlanCapableConfiguredRun } from "./configured-run.js";
import type { IntentOnlyConfiguredRun, PlanCapableConfiguredRun } from "./configured-run.js";

/** Private trusted proposal carried only by the runtime source factory. */
const passThroughProposal: unique symbol = Symbol("passThroughProposal");

/** A model-backed Intent source tied to its core proposal definition. */
export interface ModelBackedIntentSource<Proposal> {
  readonly kind: "model_backed";
  readonly proposal: Pick<ProposalDefinition, "proposal_schema"> & {
    decode(value: unknown): SchemaDecodeResult<Proposal>;
  };
}

/** The deterministic Intent source that avoids an Intent model call. */
export interface PassThroughIntentSource<Proposal = PassThroughIntentProposal> {
  readonly kind: "pass_through";
  readonly [passThroughProposal]: Proposal;
}

/** Constructs the trusted deterministic Intent source. */
export function passThroughIntentSource(): PassThroughIntentSource {
  return {
    kind: "pass_through",
    [passThroughProposal]: PASS_THROUGH_INTENT_PROPOSAL,
  };
}

/** Configuration common to Intent-only and Plan-capable runs. */
export interface RuntimeOptions<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
> {
  readonly modelClient: ModelClient;
  readonly modelName: string;
  readonly intentSettings: ModelSettings;
  readonly planSettings: ModelSettings;
  readonly sceneActions: SceneActions<Scene, TargetValue, IntentValue, OperationData>;
  readonly observers?: readonly RunObserver<Scene>[];
  readonly embeddedIdentityDelta?: number | null;
}

/** Complete construction input for one Intent-only single-use run. */
export type IntentOnlyRunConfig<
  Proposal,
  IntentValue extends StopIntent,
  Scene,
  TargetValue extends Target,
  TerminalData = unknown,
  TerminalMetadata = unknown,
> = RuntimeOptions<Scene, TargetValue, IntentValue, Operation> &
  Readonly<{
    intent: ModelBackedIntentSource<Proposal> | PassThroughIntentSource<Proposal>;
    recipe: IntentOnlyRecipe<
      Proposal,
      IntentValue,
      Scene,
      TargetValue,
      TerminalData,
      TerminalMetadata
    >;
  }>;

/** Complete construction input for one Plan-capable single-use run. */
export type PlanCapableRunConfig<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
  TerminalData = unknown,
  TerminalMetadata = unknown,
> = RuntimeOptions<Scene, TargetValue, IntentValue, OperationData> &
  Readonly<{
    intent: ModelBackedIntentSource<Proposal> | PassThroughIntentSource<Proposal>;
    recipe: PlanCapableRecipe<
      Proposal,
      IntentValue,
      Scene,
      TargetValue,
      OperationData,
      TerminalData,
      TerminalMetadata
    >;
  }>;

/** Captured deterministic Scene method references for one configured run. */
interface CapturedSceneActions<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
> extends SceneActions<Scene, TargetValue, IntentValue, OperationData> {}

/** Captured Intent proposal source and exact model-output decoder. */
type CapturedIntentSource<Proposal> =
  | Readonly<{ kind: "pass_through"; proposal: Proposal }>
  | Readonly<{
      kind: "model_backed";
      proposalSchema: ProposalSchema;
      decode(value: unknown): SchemaDecodeResult<Proposal>;
    }>;

/** Captured Recipe policy common to both run types. */
type CapturedIntentPolicy<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
> = Pick<
  PlanCapableRecipe<Proposal, IntentValue, Scene, TargetValue>,
  "noTargetError" | "buildIntentMessages" | "deriveIntent" | "validateIntent" | "stopTerminal"
>;

/** Captured Plan policy and registry mechanics for a continuing run. */
interface CapturedPlanPolicy<
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
> {
  readonly registry: OperationRegistry<OperationData, Scene, IntentValue, TargetValue>;
  readonly proposalSchema: ProposalSchema;
  buildPlanMessages(
    intent: IntentValue,
    context: RecipeMessageContext<Scene, TargetValue>,
  ): import("sergent-ts-core").ModelMessages;
  derivePlan: PlanCapableRecipe<
    unknown,
    IntentValue,
    Scene,
    TargetValue,
    OperationData
  >["derivePlan"];
  validatePlan: PlanCapableRecipe<
    unknown,
    IntentValue,
    Scene,
    TargetValue,
    OperationData
  >["validatePlan"];
  compilePatch: PlanCapableRecipe<
    unknown,
    IntentValue,
    Scene,
    TargetValue,
    OperationData
  >["compilePatch"];
}

/** Fully captured single-use execution state stored behind the opaque value. */
export interface RuntimeConfiguration<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
> {
  readonly kind: "intent_only" | "plan_capable";
  invokeModel(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<import("sergent-ts-core").ModelOutcome>;
  readonly modelName: string;
  readonly intentSettings: ModelSettings;
  readonly planSettings: ModelSettings;
  readonly intentSource: CapturedIntentSource<Proposal>;
  readonly intentPolicy: CapturedIntentPolicy<Proposal, IntentValue, Scene, TargetValue>;
  readonly planPolicy: CapturedPlanPolicy<IntentValue, Scene, TargetValue, OperationData> | null;
  readonly actions: CapturedSceneActions<Scene, TargetValue, IntentValue, OperationData>;
  readonly observers: readonly RunObserver<Scene>[];
  readonly embeddedIdentityDelta: number | null;
}

/** Captures the optional exact-one embedded-identity policy. */
function embeddedDelta(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value !== 1) throw new TypeError("Embedded identity delta must be exactly one");
  return 1;
}

/** Captures SceneActions method identities so a run never rereads configuration. */
function captureActions<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  actions: SceneActions<Scene, TargetValue, IntentValue, OperationData>,
): CapturedSceneActions<Scene, TargetValue, IntentValue, OperationData> {
  return {
    identity: actions.identity.bind(actions),
    clone: actions.clone.bind(actions),
    selectTarget: actions.selectTarget.bind(actions),
    targetExists: actions.targetExists.bind(actions),
    apply: actions.apply.bind(actions),
    verify: actions.verify.bind(actions),
    rebase: actions.rebase?.bind(actions),
  };
}

/** Captures one Intent source and its exact schema/decoder pair. */
function captureIntentSource<Proposal>(
  source: ModelBackedIntentSource<Proposal> | PassThroughIntentSource<Proposal>,
): CapturedIntentSource<Proposal> {
  if (source.kind === "pass_through") {
    return { kind: "pass_through", proposal: source[passThroughProposal] };
  }
  return {
    kind: "model_backed",
    proposalSchema: source.proposal.proposal_schema,
    decode: source.proposal.decode.bind(source.proposal),
  };
}

/** Captures Recipe method identities shared by both run shapes. */
function captureIntentPolicy<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
>(
  recipe: CapturedIntentPolicy<Proposal, IntentValue, Scene, TargetValue>,
): CapturedIntentPolicy<Proposal, IntentValue, Scene, TargetValue> {
  return {
    noTargetError: recipe.noTargetError,
    buildIntentMessages: recipe.buildIntentMessages.bind(recipe),
    deriveIntent: recipe.deriveIntent.bind(recipe),
    validateIntent: recipe.validateIntent.bind(recipe),
    stopTerminal: recipe.stopTerminal.bind(recipe),
  };
}

/** Captures registry, Plan schema, and every continuing Recipe hook. */
function capturePlanPolicy<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  recipe: PlanCapableRecipe<Proposal, IntentValue, Scene, TargetValue, OperationData>,
): CapturedPlanPolicy<IntentValue, Scene, TargetValue, OperationData> {
  const registry = recipe.registry;
  return {
    registry,
    proposalSchema: registry.plan_proposal.proposal_schema,
    buildPlanMessages: recipe.buildPlanMessages.bind(recipe),
    derivePlan: recipe.derivePlan.bind(recipe),
    validatePlan: recipe.validatePlan.bind(recipe),
    compilePatch: recipe.compilePatch.bind(recipe),
  };
}

/** Captures model invocation without retaining a mutable configuration lookup. */
function captureModelClient(
  client: ModelClient,
): RuntimeConfiguration<unknown, Intent, unknown, Target, Operation>["invokeModel"] {
  return client.invoke.bind(client);
}

/** Constructs one captured Intent-only configured run. */
export function configureIntentOnlyRun<
  Proposal,
  IntentValue extends StopIntent,
  Scene,
  TargetValue extends Target,
  TerminalData = unknown,
  TerminalMetadata = unknown,
>(
  config: IntentOnlyRunConfig<
    Proposal,
    IntentValue,
    Scene,
    TargetValue,
    TerminalData,
    TerminalMetadata
  >,
): IntentOnlyConfiguredRun<Scene> {
  const configuration: RuntimeConfiguration<Proposal, IntentValue, Scene, TargetValue, Operation> =
    {
      kind: "intent_only",
      invokeModel: captureModelClient(config.modelClient),
      modelName: config.modelName,
      intentSettings: config.intentSettings,
      planSettings: config.planSettings,
      intentSource: captureIntentSource(config.intent),
      intentPolicy: captureIntentPolicy(config.recipe),
      planPolicy: null,
      actions: captureActions(config.sceneActions),
      observers: [...(config.observers ?? [])],
      embeddedIdentityDelta: embeddedDelta(config.embeddedIdentityDelta),
    };
  return createIntentOnlyConfiguredRun(configuration);
}

/** Constructs one captured Plan-capable configured run. */
export function configurePlanCapableRun<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
  TerminalData = unknown,
  TerminalMetadata = unknown,
>(
  config: PlanCapableRunConfig<
    Proposal,
    IntentValue,
    Scene,
    TargetValue,
    OperationData,
    TerminalData,
    TerminalMetadata
  >,
): PlanCapableConfiguredRun<Scene> {
  const configuration: RuntimeConfiguration<
    Proposal,
    IntentValue,
    Scene,
    TargetValue,
    OperationData
  > = {
    kind: "plan_capable",
    invokeModel: captureModelClient(config.modelClient),
    modelName: config.modelName,
    intentSettings: config.intentSettings,
    planSettings: config.planSettings,
    intentSource: captureIntentSource(config.intent),
    intentPolicy: captureIntentPolicy(config.recipe),
    planPolicy: capturePlanPolicy(config.recipe),
    actions: captureActions(config.sceneActions),
    observers: [...(config.observers ?? [])],
    embeddedIdentityDelta: embeddedDelta(config.embeddedIdentityDelta),
  };
  return createPlanCapableConfiguredRun(configuration);
}
