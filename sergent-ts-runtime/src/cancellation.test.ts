import { describe, expect, test } from "bun:test";
import {
  applied,
  createIntentOnlyRecipe,
  createFailedModelAttempt,
  createMessages,
  createModelCancellation,
  createModelSettings,
  createProposalDefinition,
  createTransportError,
  createUserMessage,
  recipeValid,
  runError,
  cancelledError,
  Type,
  verificationReport,
} from "sergent-ts-core";
import type { ModelClient, SceneActions, StopIntent } from "sergent-ts-core";

import { configureIntentOnlyRun, invokeRun } from "./index.js";
import type { IntentOnlyConfiguredRun } from "./index.js";
import {
  configuredPlanRun,
  incrementProposal,
  parkedModel,
  scriptedModel,
  TEST_MIND_BUF,
  testScene,
  TestSceneActions,
} from "./runtime-fixtures.test.js";
import type { TestScene, TestTarget } from "./runtime-fixtures.test.js";

/** Constructs a model-backed stop run for cancellation around Intent invocation. */
function configuredIntentRun(client: ModelClient): IntentOnlyConfiguredRun<TestScene> {
  const proposal = createProposalDefinition(
    "IntentProposal",
    Type.Object({ decision: Type.Enum(["stop"]) }, { additionalProperties: false }),
  );
  const target = Object.freeze({ id: "selected" });
  const actions: SceneActions<TestScene, TestTarget, StopIntent> = {
    identity: (scene) => ({ scene_id: scene.sceneId, revision: scene.revision }),
    clone: (scene) => structuredClone(scene),
    selectTarget: () => target,
    targetExists: () => true,
    apply: (scene) => applied(scene),
    verify: () => verificationReport(),
  };
  const recipe = createIntentOnlyRecipe<
    Readonly<{ decision: "stop" }>,
    StopIntent,
    TestScene,
    TestTarget
  >({
    noTargetError: runError("no_target", "No target"),
    buildIntentMessages: () => createMessages([createUserMessage("decide")]),
    deriveIntent: (): StopIntent => ({ flow: "stop" }),
    validateIntent: () => recipeValid(),
    stopTerminal: () => ({ data: "done", metadata: {} }),
  });
  const settings = createModelSettings(64, 1_000, "low");
  return configureIntentOnlyRun({
    modelClient: client,
    modelName: "fixture/model",
    intentSettings: settings,
    planSettings: settings,
    sceneActions: actions,
    intent: { kind: "model_backed", proposal },
    recipe,
  });
}

/** Reads the reached cancellation checkpoint from a terminal result. */
function checkpoint(
  result: Awaited<ReturnType<typeof invokeRun<TestScene>>["result"]>,
): string | null | undefined {
  return result.run_record.cancellation?.checkpoint;
}

/** Models an SDK that rejects one microtask after observing caller abort. */
function delayedSdkRejection(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const rejectCall = (): void => {
      queueMicrotask(() => reject(new Error("SDK observed abort")));
    };
    signal.addEventListener("abort", rejectCall, { once: true });
  });
}

describe("runtime cancellation checkpoints", () => {
  test("cancels before model-backed Intent without invoking the model", async () => {
    const client = scriptedModel([]);
    const controller = new AbortController();
    controller.abort();

    const result = await invokeRun(
      configuredIntentRun(client),
      testScene(),
      TEST_MIND_BUF,
      controller.signal,
    ).result;

    expect(result.run_record.outcome.status).toBe("cancelled");
    expect(checkpoint(result)).toBe("before_intent");
    expect(result.stage).toBe("intent_call");
    expect(client.requests).toHaveLength(0);
    expect(result.run_record.steps[1]?.model_call?.attempts).toEqual([]);
  });

  test("cancels after Intent validation before the flow gate", async () => {
    const controller = new AbortController();
    const configured = configuredPlanRun({
      modelClient: scriptedModel([]),
      intentFlow: "stop",
      validateIntent: () => {
        controller.abort();
        return recipeValid();
      },
    });

    const result = await invokeRun(configured, testScene(), TEST_MIND_BUF, controller.signal)
      .result;

    expect(result.run_record.outcome.status).toBe("cancelled");
    expect(checkpoint(result)).toBe("after_intent_validation");
    expect(result.stage).toBe("intent");
  });
});

describe("runtime precommit cancellation checkpoints", () => {
  test("cancels after Patch validation and before dry-run", async () => {
    const controller = new AbortController();
    const actions = new TestSceneActions({
      apply: () => {
        throw new Error("dry-run must not start");
      },
    });
    const configured = configuredPlanRun({
      modelClient: scriptedModel([incrementProposal()]),
      actions,
      validatePlan: () => {
        controller.abort();
        return recipeValid();
      },
    });

    const result = await invokeRun(configured, testScene(), TEST_MIND_BUF, controller.signal)
      .result;

    expect(result.run_record.outcome.status).toBe("cancelled");
    expect(checkpoint(result)).toBe("before_dry_run");
    expect(result.stage).toBe("patch");
  });

  test("cancels after verification immediately before commit", async () => {
    const controller = new AbortController();
    const actions = new TestSceneActions({
      verify: () => {
        controller.abort();
        return verificationReport();
      },
    });
    const base = testScene();
    const configured = configuredPlanRun({
      modelClient: scriptedModel([incrementProposal()]),
      actions,
    });

    const result = await invokeRun(configured, base, TEST_MIND_BUF, controller.signal).result;

    expect(result.run_record.outcome.status).toBe("cancelled");
    expect(checkpoint(result)).toBe("before_commit");
    expect(result.stage).toBe("commit");
    expect(result.scene).toEqual(base);
  });
});

describe("runtime in-flight model cancellation", () => {
  test("prefers microtask-mapped adapter cancellation with completed attempt evidence", async () => {
    const retry = createFailedModelAttempt(
      {
        startedAt: "2026-09-01T00:00:00.000Z",
        finishedAt: "2026-09-01T00:00:00.001Z",
        durationMs: 1,
      },
      createTransportError("timeout", "first attempt timed out"),
    );
    const cancellation = createModelCancellation(
      cancelledError("provider observed cancellation"),
      { provider: "fixture", model: "test-model", sdkPackage: null, sdkVersion: null },
      [retry],
    );
    let entered: (() => void) | undefined;
    const invoked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const client: ModelClient = {
      invoke(_request, signal): Promise<ReturnType<typeof createModelCancellation>> {
        entered?.();
        return delayedSdkRejection(signal).catch(() => cancellation);
      },
    };
    const controller = new AbortController();
    const handle = invokeRun(
      configuredPlanRun({ modelClient: client }),
      testScene(),
      TEST_MIND_BUF,
      controller.signal,
    );
    await invoked;
    controller.abort();
    const result = await handle.result;
    const modelCall = result.run_record.steps[2]?.model_call;

    expect(result.run_record.outcome.error).toBe(cancellation.error);
    expect(checkpoint(result)).toBe("task_cancelled");
    expect(modelCall?.attempts).toHaveLength(1);
    expect(modelCall?.attempts[0]).toMatchObject({
      status: "failure",
      retryable: true,
      error: { kind: "timeout" },
    });
  });
});

describe("runtime interrupted model awaits", () => {
  test("interrupts a parked Intent call with request-only evidence", async () => {
    const parked = parkedModel();
    const controller = new AbortController();
    const handle = invokeRun(
      configuredIntentRun(parked.client),
      testScene(),
      TEST_MIND_BUF,
      controller.signal,
    );
    await parked.entered;

    controller.abort();
    const result = await handle.result;
    const modelCall = result.run_record.steps[1]?.model_call;

    expect(result.run_record.outcome.status).toBe("cancelled");
    expect(checkpoint(result)).toBe("task_cancelled");
    expect(result.stage).toBe("intent_call");
    expect(parked.signals[0]).toBe(controller.signal);
    expect(modelCall?.attempts).toEqual([]);
    expect(modelCall?.identity).toBeNull();
    expect(modelCall?.payloads.raw_response).toBeNull();
  });

  test("interrupts a parked Plan call with request-only evidence", async () => {
    const parked = parkedModel();
    const controller = new AbortController();
    const handle = invokeRun(
      configuredPlanRun({ modelClient: parked.client }),
      testScene(),
      TEST_MIND_BUF,
      controller.signal,
    );
    await parked.entered;

    controller.abort();
    const result = await handle.result;
    const modelCall = result.run_record.steps[2]?.model_call;

    expect(result.run_record.outcome.status).toBe("cancelled");
    expect(checkpoint(result)).toBe("task_cancelled");
    expect(result.stage).toBe("plan_call");
    expect(parked.signals[0]).toBe(controller.signal);
    expect(modelCall?.attempts).toEqual([]);
    expect(modelCall?.payloads.parsed_json).toBeNull();
  });
});
