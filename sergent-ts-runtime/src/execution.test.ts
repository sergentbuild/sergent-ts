import { describe, expect, test } from "bun:test";
import {
  applied,
  createIntentOnlyRecipe,
  createMessages,
  createModelSettings,
  createProposalDefinition,
  createUserMessage,
  operationFault,
  recipeValid,
  runError,
  Type,
  validationIssue,
  verificationReport,
} from "sergent-ts-core";
import type { SceneActions, StopIntent } from "sergent-ts-core";
import type { ProgressSnapshot } from "sergent-ts-observability";

import { configureIntentOnlyRun, invokeRun } from "./index.js";
import {
  configuredPlanRun,
  incrementProposal,
  modelSuccess,
  progressRecorder,
  scriptedModel,
  TEST_MIND_BUF,
  testScene,
  TestSceneActions,
} from "./runtime-fixtures.test.js";
import type { TestScene, TestTarget } from "./runtime-fixtures.test.js";

/** Creates SceneActions for a stop-only Recipe whose mutation methods are unreachable. */
function stopActions<IntentValue extends StopIntent>(
  target: TestTarget,
): SceneActions<TestScene, TestTarget, IntentValue> {
  return {
    identity: (scene) => ({ scene_id: scene.sceneId, revision: scene.revision }),
    clone: (scene) => structuredClone(scene),
    selectTarget: () => target,
    targetExists: () => true,
    apply: (scene) => applied(scene),
    verify: () => verificationReport(),
  };
}

describe("runtime model-backed stop", () => {
  test("runs model-backed stop with the exact schema, model, settings, and crossing", async () => {
    const proposal = createProposalDefinition(
      "IntentProposal",
      Type.Object({ decision: Type.Enum(["stop"]) }, { additionalProperties: false }),
    );
    const client = scriptedModel([modelSuccess({ decision: "stop" })]);
    const settings = createModelSettings(77, 912, "high");
    const target = Object.freeze({ id: "selected" });
    const messages = createMessages([createUserMessage("decide")]);
    const recipe = createIntentOnlyRecipe({
      noTargetError: runError("no_target", "No target"),
      buildIntentMessages: (context) => {
        expect(context.proposalSchema).toBe(proposal.proposal_schema);
        return messages;
      },
      deriveIntent: (): StopIntent & { readonly reason: string } => ({
        flow: "stop",
        reason: "done",
      }),
      validateIntent: () => recipeValid(),
      stopTerminal: () => ({ data: "model stopped", metadata: { source: "model" } }),
    });
    const configured = configureIntentOnlyRun({
      modelClient: client,
      modelName: "fixture/exact-selection",
      intentSettings: settings,
      planSettings: createModelSettings(11, 22, "low"),
      sceneActions: stopActions(target),
      intent: { kind: "model_backed", proposal },
      recipe,
    });

    const result = await invokeRun(
      configured,
      testScene(),
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;
    const request = client.requests[0];
    const call = result.run_record.steps[1]?.model_call;

    expect(result.run_record.outcome.status).toBe("success");
    expect(result.stage).toBe("intent");
    expect(request?.modelName).toBe("fixture/exact-selection");
    expect(request?.proposalSchema).toBe(proposal.proposal_schema);
    expect(request?.modelSettings).toBe(settings);
    expect(request?.messages).toBe(messages);
    expect(call?.payloads.parsed_proposal?.status).toBe("captured");
  });
});

describe("runtime Intent typed crossing", () => {
  test("keeps a typed-crossing failure at intent_call without typed proposal evidence", async () => {
    const proposal = createProposalDefinition(
      "IntentProposal",
      Type.Object({ decision: Type.Enum(["stop"]) }, { additionalProperties: false }),
    );
    const client = scriptedModel([modelSuccess({ decision: "continue" })]);
    const target = Object.freeze({ id: "selected" });
    const recipe = createIntentOnlyRecipe({
      noTargetError: runError("no_target", "No target"),
      buildIntentMessages: () => createMessages([createUserMessage("decide")]),
      deriveIntent: (): StopIntent => ({ flow: "stop" }),
      validateIntent: () => recipeValid(),
      stopTerminal: () => ({ data: null, metadata: {} }),
    });
    const settings = createModelSettings(64, 500, "low");
    const configured = configureIntentOnlyRun({
      modelClient: client,
      modelName: "fixture/model",
      intentSettings: settings,
      planSettings: settings,
      sceneActions: stopActions(target),
      intent: { kind: "model_backed", proposal },
      recipe,
    });

    const result = await invokeRun(
      configured,
      testScene(),
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;
    const modelCall = result.run_record.steps[1]?.model_call;

    expect(result.run_record.outcome.status).toBe("failure");
    expect(result.run_record.outcome.error?.kind).toBe("schema_validation_failed");
    expect(result.stage).toBe("intent_call");
    expect(modelCall?.payloads.parsed_json).toEqual({ decision: "continue" });
    expect(modelCall?.payloads.parsed_proposal).toBeNull();
  });
});

describe("runtime Plan, Patch, and rehearsal", () => {
  test("commits a full plain run with exact stages, steps, progress, and isolation", async () => {
    const progress: ProgressSnapshot[] = [];
    const client = scriptedModel([incrementProposal(3)]);
    let planSchema: import("sergent-ts-core").ProposalSchema | undefined;
    const before = testScene(4, 10);
    const configured = configuredPlanRun({
      modelClient: client,
      observers: [progressRecorder(progress)],
      observePlanSchema: (schema) => {
        planSchema = schema;
      },
    });

    const result = await invokeRun(configured, before, TEST_MIND_BUF, new AbortController().signal)
      .result;

    expect(result.run_record.outcome.status).toBe("success");
    expect(client.requests[0]?.modelName).toBe("fixture/test-model");
    expect(client.requests[0]?.proposalSchema).toBe(planSchema);
    expect(client.requests[0]?.modelSettings).toMatchObject({
      maxOutputTokens: 128,
      timeoutMs: 1_000,
      thinkingEffort: "low",
    });
    expect(result.scene).toEqual({ ...before, revision: 5, value: 13 });
    expect(before).toEqual(testScene(4, 10));
    expect(result.run_record.steps.map((step) => step.name)).toEqual([
      "process_input",
      "intent",
      "execution_plan",
      "patch",
      "commit",
    ]);
    expect(progress.map((snapshot) => snapshot.stage)).toEqual([
      "queued",
      "started",
      "intent",
      "plan_call",
      "execution_plan",
      "patch",
      "dry_run",
      "commit",
      "commit",
    ]);
    expect(progress.at(-1)?.status).toBe("success");
    expect(result.run_record.steps[4]?.output?.value).toEqual({
      commit_kind: "plain",
      metadata: {},
    });
    expect(result.run_record.outcome.terminal).toBeNull();
  });
});

describe("runtime admissibility and Patch isolation", () => {
  test("stops at the first inadmissible operation on fresh stable-base clones", async () => {
    const seen: TestScene[] = [];
    const client = scriptedModel([
      modelSuccess({
        operations: [
          { call: "increment", amount: 1, labels: ["first"] },
          { call: "increment", amount: 2, labels: ["second"] },
        ],
      }),
    ]);
    const configured = configuredPlanRun({
      modelClient: client,
      admissibility: (_operation, scene) => {
        seen.push(scene);
        return seen.length === 1
          ? { ok: true }
          : { ok: false, issue: validationIssue("budget", "second rejected") };
      },
    });

    const result = await invokeRun(
      configured,
      testScene(4, 10),
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;

    expect(result.run_record.outcome.status).toBe("failure");
    expect(result.run_record.outcome.error?.kind).toBe("validation_error");
    expect(result.run_record.outcome.error?.metadata.index).toBe(1);
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]);
    expect(seen.map((scene) => scene.value)).toEqual([10, 10]);
  });

  test("preserves Patch isolation and the exact Target through application callbacks", async () => {
    const parsed = {
      operations: [{ call: "increment", amount: 2, labels: ["original"] }],
    };
    const client = scriptedModel([modelSuccess(parsed)]);
    const actions = new TestSceneActions({
      apply: (scene, patch) => {
        const operation = patch.steps[0]?.operation;
        if (operation !== undefined) operation.labels.push("application-only");
        return applied({ ...scene, value: scene.value + 2, revision: scene.revision + 1 });
      },
    });
    const configured = configuredPlanRun({ modelClient: client, actions });

    const result = await invokeRun(
      configured,
      testScene(),
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;
    const planOutput = result.run_record.steps[2]?.output;

    expect(result.run_record.outcome.status).toBe("success");
    expect(planOutput).not.toBeNull();
    expect(actions.observedTargets.every((target) => target === actions.target)).toBe(true);
    expect(parsed.operations[0]?.labels).toEqual(["original"]);
  });
});

describe("runtime rehearsal rejection", () => {
  test("returns the base Scene for application faults and verification rejection", async () => {
    const faultClient = scriptedModel([incrementProposal()]);
    const faultActions = new TestSceneActions({
      apply: (_scene, patch) =>
        operationFault(
          patch.steps[0]?.op_id ??
            (() => {
              throw new Error("Fixture Patch is empty");
            })(),
          runError("application_error", "apply failed"),
        ),
    });
    const base = testScene();
    const fault = await invokeRun(
      configuredPlanRun({ modelClient: faultClient, actions: faultActions }),
      base,
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;
    const verifyClient = scriptedModel([incrementProposal()]);
    const verifyActions = new TestSceneActions({
      verify: () => verificationReport([validationIssue("invariant", "transition rejected")]),
    });
    const rejected = await invokeRun(
      configuredPlanRun({ modelClient: verifyClient, actions: verifyActions }),
      base,
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;

    expect(fault.run_record.outcome.status).toBe("failure");
    expect(fault.run_record.outcome.error?.kind).toBe("application_error");
    expect(fault.scene).toEqual(base);
    expect(rejected.run_record.outcome.status).toBe("failure");
    expect(rejected.run_record.outcome.error?.kind).toBe("validation_error");
    expect(rejected.scene).toEqual(base);
  });
});

describe("runtime Patch and identity validation", () => {
  test("rejects a compiled Patch whose base differs from the validated Plan", async () => {
    const base = testScene();
    const configured = configuredPlanRun({
      modelClient: scriptedModel([incrementProposal()]),
      compilePatch: (plan) => ({
        base: { scene_id: plan.base.scene_id, revision: plan.base.revision + 1 },
        steps: plan.steps,
      }),
    });

    const result = await invokeRun(configured, base, TEST_MIND_BUF, new AbortController().signal)
      .result;

    expect(result.run_record.outcome.status).toBe("failure");
    expect(result.run_record.outcome.error?.kind).toBe("patch_validation");
    expect(result.stage).toBe("patch");
    expect(result.scene).toEqual(base);
  });

  test("enforces optional embedded Scene identity consistency after rehearsal", async () => {
    const base = testScene();
    const configured = configuredPlanRun({
      modelClient: scriptedModel([incrementProposal()]),
      actions: new TestSceneActions({
        apply: (scene) => applied({ ...scene, revision: scene.revision + 2 }),
      }),
      embeddedIdentityDelta: 1,
    });

    const result = await invokeRun(configured, base, TEST_MIND_BUF, new AbortController().signal)
      .result;

    expect(result.run_record.outcome.status).toBe("failure");
    expect(result.run_record.outcome.error?.kind).toBe("patch_validation");
    expect(result.run_record.outcome.error?.metadata.expected_identity).toEqual({
      scene_id: base.sceneId,
      revision: base.revision + 1,
    });
    expect(result.stage).toBe("dry_run");
    expect(result.scene).toEqual(base);
  });

  test("rejects an embedded Scene revision delta other than one at construction", () => {
    expect(() =>
      configuredPlanRun({
        modelClient: scriptedModel([incrementProposal()]),
        embeddedIdentityDelta: 2,
      }),
    ).toThrow(TypeError);
  });
});
