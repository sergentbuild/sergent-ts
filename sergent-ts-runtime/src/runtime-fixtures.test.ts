import {
  admissible,
  applied,
  createMessages,
  createModelSettings,
  createModelSuccess,
  createOperationRegistry,
  createPlanCapableRecipe,
  createSuccessfulModelAttempt,
  createUserMessage,
  defineOperation,
  recipeValid,
  runError,
  Type,
  verificationReport,
} from "sergent-ts-core";
import type {
  AdmissibilityResult,
  ApplyResult,
  ExecutionPlan,
  MindBuf,
  ModelClient,
  ModelOutcome,
  ModelRequest,
  OperationRegistry,
  PassThroughIntentProposal,
  Patch,
  RebaseResult,
  RecipeValidationResult,
  SceneActions,
  SceneId,
  SceneIdentity,
  StopTerminal,
  Target,
  VerificationReport,
} from "sergent-ts-core";
import type { ProgressSnapshot, RunObserver } from "sergent-ts-observability";

import { configurePlanCapableRun, passThroughIntentSource } from "./index.js";
import type { PlanCapableConfiguredRun } from "./index.js";

/** Fixed Scene identity used by all runtime fixtures. */
const TEST_SCENE_ID = "scene_00000000000000000000000000000001" as SceneId;

/** Mutable application Scene used to make clone ownership observable. */
export interface TestScene {
  sceneId: SceneId;
  revision: number;
  value: number;
  targetPresent: boolean;
}

/** Exact selected Target object used by application callbacks. */
export interface TestTarget extends Target {
  readonly id: string;
}

/** Representative stop-or-continue Intent. */
export type TestIntent =
  | Readonly<{ flow: "stop"; reason: string }>
  | Readonly<{ flow: "continue"; reason: string }>;

/** Operand schema for the runtime fixture's one registered operation. */
const incrementOperands = Type.Object(
  { amount: Type.Number(), labels: Type.Array(Type.String()) },
  { additionalProperties: false },
);

/** Concrete operation branch decoded by the fixture registry. */
export type TestOperation = Readonly<{
  call: "increment";
  amount: number;
  labels: string[];
}>;

/** Deterministic application callbacks varied by individual tests. */
export interface ActionBehavior {
  readonly selectTarget?: (scene: TestScene) => TestTarget | null;
  readonly targetExists?: (scene: TestScene, target: TestTarget) => boolean;
  readonly apply?: (
    scene: TestScene,
    patch: Patch<TestOperation>,
    intent: TestIntent,
    target: TestTarget,
  ) => ApplyResult<TestScene>;
  readonly verify?: (
    before: TestScene,
    after: TestScene,
    intent: TestIntent,
    target: TestTarget,
  ) => VerificationReport;
  readonly rebase?: (
    patch: Patch<TestOperation>,
    base: TestScene,
    current: TestScene,
    intent: TestIntent,
    target: TestTarget,
  ) => RebaseResult<TestOperation>;
}

/** SceneActions fake that records clone and exact Target flow. */
export class TestSceneActions
  implements SceneActions<TestScene, TestTarget, TestIntent, TestOperation>
{
  public readonly target: TestTarget = Object.freeze({ id: "selected" });
  public readonly cloneInputs: TestScene[] = [];
  public readonly observedTargets: TestTarget[] = [];

  /** Captures behavior once for the lifetime of the fake. */
  public constructor(private readonly behavior: ActionBehavior = {}) {}

  /** Returns embedded application Scene identity. */
  public identity(scene: TestScene): SceneIdentity {
    return Object.freeze({ scene_id: scene.sceneId, revision: scene.revision });
  }

  /** Produces and records a fresh mutable clone. */
  public clone(scene: TestScene): TestScene {
    this.cloneInputs.push(scene);
    return structuredClone(scene);
  }

  /** Selects the stable fixture Target unless a test overrides selection. */
  public selectTarget(scene: TestScene): TestTarget | null {
    return this.behavior.selectTarget === undefined
      ? this.target
      : this.behavior.selectTarget(scene);
  }

  /** Checks the exact selected Target against the supplied Scene. */
  public targetExists(scene: TestScene, target: TestTarget): boolean {
    this.observedTargets.push(target);
    return this.behavior.targetExists === undefined
      ? scene.targetPresent
      : this.behavior.targetExists(scene, target);
  }

  /** Applies the complete Patch once or delegates to test behavior. */
  public apply(
    scene: TestScene,
    patch: Patch<TestOperation>,
    intent: TestIntent,
    target: TestTarget,
  ): ApplyResult<TestScene> {
    this.observedTargets.push(target);
    const overridden = this.behavior.apply?.(scene, patch, intent, target);
    if (overridden !== undefined) return overridden;
    const amount = patch.steps.reduce((sum, step) => sum + step.operation.amount, 0);
    return applied({ ...scene, value: scene.value + amount, revision: scene.revision + 1 });
  }

  /** Verifies the complete transition or delegates to test behavior. */
  public verify(
    before: TestScene,
    after: TestScene,
    intent: TestIntent,
    target: TestTarget,
  ): VerificationReport {
    this.observedTargets.push(target);
    return this.behavior.verify?.(before, after, intent, target) ?? verificationReport();
  }

  /** Delegates deterministic replacement policy to test behavior. */
  public rebase(
    patch: Patch<TestOperation>,
    base: TestScene,
    current: TestScene,
    intent: TestIntent,
    target: TestTarget,
  ): RebaseResult<TestOperation> {
    const result = this.behavior.rebase?.(patch, base, current, intent, target);
    if (result === undefined) throw new Error("Fixture rebase behavior was not configured");
    return result;
  }
}

/** Creates one ordinary Scene value. */
export function testScene(revision = 4, value = 10): TestScene {
  return { sceneId: TEST_SCENE_ID, revision, value, targetPresent: true };
}

/** Fixed already-curated MindBuf snapshot. */
export const TEST_MIND_BUF: MindBuf = Object.freeze({ export: () => "bounded observation" });

/** Creates an observer that records every reached progress value. */
export function progressRecorder(values: ProgressSnapshot[]): RunObserver<TestScene> {
  return {
    progress(snapshot): undefined {
      values.push(snapshot);
      return undefined;
    },
    finished(): undefined {
      return undefined;
    },
  };
}

/** Fixed successful attempt evidence used by scripted model outcomes. */
const MODEL_ATTEMPT = createSuccessfulModelAttempt({
  startedAt: "2026-09-01T00:00:00.000Z",
  finishedAt: "2026-09-01T00:00:00.001Z",
  durationMs: 1,
});

/** Constructs one valid model success around arbitrary parsed JSON. */
export function modelSuccess(parsedJson: import("sergent-ts-core").JsonObject): ModelOutcome {
  return createModelSuccess(
    { provider: "fixture", model: "test-model", sdkPackage: null, sdkVersion: null },
    [MODEL_ATTEMPT],
    JSON.stringify(parsedJson),
    parsedJson,
    { latencyMs: 1, tokens: null, requestId: "fixture-request" },
  );
}

/** Scripted ModelClient with observable exact requests. */
export interface ScriptedModel extends ModelClient {
  readonly requests: ModelRequest[];
}

/** Creates a ModelClient that returns a finite ordered outcome script. */
export function scriptedModel(outcomes: ModelOutcome[]): ScriptedModel {
  const script = [...outcomes];
  const requests: ModelRequest[] = [];
  return {
    requests,
    invoke(request): Promise<ModelOutcome> {
      requests.push(request);
      const outcome = script.shift();
      if (outcome === undefined) throw new Error("Fixture model script is exhausted");
      return Promise.resolve(outcome);
    },
  };
}

/** Externally controlled one-shot gate for deterministic parked model calls. */
export interface ParkedModel {
  readonly client: ModelClient;
  readonly requests: readonly ModelRequest[];
  readonly signals: readonly AbortSignal[];
  readonly entered: Promise<void>;
  release(outcome: ModelOutcome): void;
}

/** Creates a ModelClient whose only invocation remains parked until released. */
export function parkedModel(): ParkedModel {
  const requests: ModelRequest[] = [];
  const signals: AbortSignal[] = [];
  let announce: (() => void) | undefined;
  let release: ((outcome: ModelOutcome) => void) | undefined;
  const entered = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const outcome = new Promise<ModelOutcome>((resolve) => {
    release = resolve;
  });
  const client: ModelClient = {
    invoke(request, signal): Promise<ModelOutcome> {
      requests.push(request);
      signals.push(signal);
      announce?.();
      return outcome;
    },
  };
  return Object.freeze({
    client,
    requests,
    signals,
    entered,
    release(value: ModelOutcome): void {
      release?.(value);
    },
  });
}

/** Optional policy hooks for the representative Plan-capable Recipe. */
export interface PlanFixtureOptions {
  readonly modelClient: ModelClient;
  readonly actions?: TestSceneActions;
  readonly intentFlow?: "stop" | "continue";
  readonly stopTerminal?: StopTerminal;
  readonly admissibility?: (operation: TestOperation, scene: TestScene) => AdmissibilityResult;
  readonly validateIntent?: () => RecipeValidationResult;
  readonly validatePlan?: (
    plan: ExecutionPlan<TestIntent, TestOperation>,
  ) => RecipeValidationResult;
  readonly observePlanSchema?: (schema: import("sergent-ts-core").ProposalSchema) => void;
  readonly compilePatch?: (plan: ExecutionPlan<TestIntent, TestOperation>) => Patch<TestOperation>;
  readonly observers?: readonly RunObserver<TestScene>[];
  readonly embeddedIdentityDelta?: number | null;
}

/** Creates one closed operation registry with an optional admissibility seam. */
function testRegistry(
  check?: PlanFixtureOptions["admissibility"],
): OperationRegistry<TestOperation, TestScene, TestIntent, TestTarget> {
  const definition = defineOperation<
    "increment",
    typeof incrementOperands,
    TestScene,
    TestIntent,
    TestTarget
  >(
    "increment",
    incrementOperands,
    (operation, context) => check?.(operation, context.scene) ?? admissible(),
  );
  return createOperationRegistry([definition]);
}

/** Creates one single-use pass-through Plan-capable runtime fixture. */
export function configuredPlanRun(
  options: PlanFixtureOptions,
): PlanCapableConfiguredRun<TestScene> {
  const registry = testRegistry(options.admissibility);
  const messages = createMessages([createUserMessage("perform the bounded change")]);
  const recipe = createPlanCapableRecipe<
    PassThroughIntentProposal,
    TestIntent,
    TestScene,
    TestTarget,
    TestOperation
  >({
    registry,
    noTargetError: runError("no_target", "No target"),
    buildIntentMessages: () => messages,
    buildPlanMessages: (_intent, context) => {
      options.observePlanSchema?.(context.proposalSchema);
      return messages;
    },
    deriveIntent: () => ({
      flow: options.intentFlow ?? "continue",
      reason: "fixture decision",
    }),
    validateIntent: () => options.validateIntent?.() ?? recipeValid(),
    validatePlan: (plan) => options.validatePlan?.(plan) ?? recipeValid(),
    compilePatch: options.compilePatch,
    stopTerminal: () =>
      options.stopTerminal ?? { data: "stopped", metadata: { source: "fixture" } },
  });
  const settings = createModelSettings(128, 1_000, "low");
  return configurePlanCapableRun({
    modelClient: options.modelClient,
    modelName: "fixture/test-model",
    intentSettings: settings,
    planSettings: settings,
    sceneActions: options.actions ?? new TestSceneActions(),
    observers: options.observers,
    embeddedIdentityDelta: options.embeddedIdentityDelta,
    intent: passThroughIntentSource(),
    recipe,
  });
}

/** Successful one-step Plan proposal for the fixture registry. */
export function incrementProposal(amount = 2): ModelOutcome {
  return modelSuccess({ operations: [{ call: "increment", amount, labels: ["original"] }] });
}
