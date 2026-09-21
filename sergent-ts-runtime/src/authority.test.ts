import { describe, expect, test } from "bun:test";
import {
  admissible,
  applied,
  rebaseConflict,
  rebased,
  runError,
  validationIssue,
} from "sergent-ts-core";
import type { JsonObject } from "sergent-ts-core";
import { projectPatchSummary } from "sergent-ts-observability";

import { invokeRun, SharedSceneAuthority } from "./index.js";
import {
  configuredPlanRun,
  incrementProposal,
  parkedModel,
  scriptedModel,
  TEST_MIND_BUF,
  testScene,
  TestSceneActions,
} from "./runtime-fixtures.test.js";
import type { TestScene } from "./runtime-fixtures.test.js";

/** Creates an isolated shared authority for one test. */
function authority(policy: "strict" | "rebase"): SharedSceneAuthority<TestScene> {
  return new SharedSceneAuthority(testScene(4, 10), 10, policy, (scene) => structuredClone(scene));
}

/** Checks the exact common merge-conflict metadata keys. */
function expectMergeKeys(metadata: JsonObject, includesValidationError: boolean): void {
  const common = ["base_revision", "current_live_revision", "patch", "scene_metadata"];
  expect(Object.keys(metadata).toSorted()).toEqual(
    includesValidationError ? [...common, "validation_error"] : common,
  );
}

describe("shared Scene exact and stale commit", () => {
  test("installs an exact rehearsal and advances external revision once", async () => {
    const shared = authority("strict");
    const result = await invokeRun(
      configuredPlanRun({ modelClient: scriptedModel([incrementProposal(3)]) }),
      shared,
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;
    const current = shared.read();

    expect(result.run_record.outcome.status).toBe("success");
    expect(result.run_record.scene).toEqual({
      scene_id: testScene().sceneId,
      revision_before: 10,
      revision_after: 11,
    });
    expect(result.scene.value).toBe(13);
    expect(current.revision).toBe(11);
    expect(current.scene.value).toBe(13);
    expect(result.run_record.steps[4]?.output?.value).toEqual({
      commit_kind: "exact",
      metadata: {},
    });
    expect(result.run_record.outcome.terminal).toBeNull();
  });

  test("returns stale_patch and the run base after a parked strict run becomes stale", async () => {
    const shared = authority("strict");
    const parked = parkedModel();
    const handle = invokeRun(
      configuredPlanRun({ modelClient: parked.client }),
      shared,
      TEST_MIND_BUF,
      new AbortController().signal,
    );
    await parked.entered;
    shared.advance(testScene(5, 100));
    parked.release(incrementProposal(3));

    const result = await handle.result;
    const current = shared.read();

    expect(result.run_record.outcome.status).toBe("failure");
    expect(result.run_record.outcome.error?.kind).toBe("stale_patch");
    expect(result.scene.value).toBe(10);
    expect(current).toEqual({ scene: testScene(5, 100), revision: 11 });
  });
});

describe("shared Scene embedded identity", () => {
  test("checks embedded revision independently from external stale revision", async () => {
    const shared = authority("strict");
    const configured = configuredPlanRun({
      modelClient: scriptedModel([incrementProposal()]),
      embeddedIdentityDelta: 1,
    });

    const result = await invokeRun(configured, shared, TEST_MIND_BUF, new AbortController().signal)
      .result;

    expect(result.run_record.outcome.status).toBe("success");
    expect(result.scene.revision).toBe(5);
    expect(result.run_record.scene.revision_before).toBe(10);
    expect(result.run_record.scene.revision_after).toBe(11);
  });
});

describe("shared Scene deterministic rebase", () => {
  test("validates, rehearses, and commits a replacement with unchanged metadata", async () => {
    const shared = authority("rebase");
    const parked = parkedModel();
    const actions = new TestSceneActions({
      rebase: (patch, _base, current) =>
        rebased(
          {
            base: { scene_id: current.sceneId, revision: 11 },
            steps: patch.steps.map((step) => ({
              op_id: step.op_id,
              operation: { call: "increment", amount: 7, labels: ["rebased"] },
            })),
          },
          { strategy: "fixture" },
        ),
    });
    const handle = invokeRun(
      configuredPlanRun({ modelClient: parked.client, actions, embeddedIdentityDelta: 1 }),
      shared,
      TEST_MIND_BUF,
      new AbortController().signal,
    );
    await parked.entered;
    shared.advance(testScene(5, 100));
    parked.release(incrementProposal(3));

    const result = await handle.result;
    const current = shared.read();

    expect(result.run_record.outcome.status).toBe("success");
    expect(result.run_record.scene.revision_after).toBe(12);
    expect(result.scene.value).toBe(107);
    expect(result.scene.revision).toBe(6);
    expect(current.revision).toBe(12);
    expect(current.scene.value).toBe(107);
    expect(result.terminal_metadata).toEqual({ strategy: "fixture" });
    expect(result.run_record.outcome.terminal).not.toBeNull();
    expect(result.run_record.steps[4]?.output?.value).toEqual({
      commit_kind: "rebased",
      metadata: { strategy: "fixture" },
    });
    expect(actions.observedTargets.every((target) => target === actions.target)).toBe(true);
  });
});

describe("shared Scene application rebase conflict", () => {
  test("projects an application conflict with authoritative revision and Patch evidence", async () => {
    const shared = authority("rebase");
    const parked = parkedModel();
    const actions = new TestSceneActions({
      rebase: () => rebaseConflict(runError("application_conflict", "overlap", { hint: "x" })),
    });
    const handle = invokeRun(
      configuredPlanRun({ modelClient: parked.client, actions }),
      shared,
      TEST_MIND_BUF,
      new AbortController().signal,
    );
    await parked.entered;
    shared.advance(testScene(5, 100));
    parked.release(incrementProposal());

    const result = await handle.result;
    const error = result.run_record.outcome.error;

    expect(result.run_record.outcome.status).toBe("failure");
    expect(error?.kind).toBe("merge_conflict");
    expect(error?.metadata.base_revision).toBe(10);
    expect(error?.metadata.current_live_revision).toBe(11);
    expect(error?.metadata.patch).toMatchObject({ operation_count: 1 });
    expect(error?.metadata.scene_metadata).toEqual({ hint: "x" });
    expectMergeKeys(error?.metadata ?? {}, false);
    expect(result.scene.value).toBe(10);
  });

  test("retains the compiled summary when application seams mutate Patch operands", async () => {
    const shared = authority("rebase");
    const parked = parkedModel();
    let compiledSummary: JsonObject | null = null;
    const rebaseLabels: string[] = [];
    const actions = new TestSceneActions({
      apply: (scene, patch) => {
        patch.steps[0]?.operation.labels.push("apply-owned");
        return applied({ ...scene, value: scene.value + 2, revision: scene.revision + 1 });
      },
      rebase: (patch) => {
        rebaseLabels.push(...(patch.steps[0]?.operation.labels ?? []));
        patch.steps[0]?.operation.labels.push("rebase-owned");
        return rebaseConflict(runError("application_conflict", "mutating overlap"));
      },
    });
    const handle = invokeRun(
      configuredPlanRun({
        modelClient: parked.client,
        actions,
        compilePatch: (plan) => {
          const patch = Object.freeze({ base: plan.base, steps: plan.steps });
          compiledSummary = projectPatchSummary(patch);
          return patch;
        },
      }),
      shared,
      TEST_MIND_BUF,
      new AbortController().signal,
    );
    await parked.entered;
    shared.advance(testScene(5, 100));
    parked.release(incrementProposal());

    const result = await handle.result;

    expect(rebaseLabels).toEqual(["original"]);
    expect(result.run_record.outcome.error?.metadata.patch).toEqual(compiledSummary);
    expect(shared.read()).toEqual({ scene: testScene(5, 100), revision: 11 });
  });
});

describe("shared Scene Patch operand isolation", () => {
  test("protects original and admitted replacement steps from application mutation", async () => {
    const shared = authority("rebase");
    const parked = parkedModel();
    const appliedLabels: string[][] = [];
    const rebaseLabels: string[] = [];
    const actions = new TestSceneActions({
      apply: (scene, patch) => {
        const operation = patch.steps[0]?.operation;
        appliedLabels.push([...(operation?.labels ?? [])]);
        operation?.labels.push("apply-owned");
        return applied({
          ...scene,
          value: scene.value + (operation?.amount ?? 0),
          revision: scene.revision + 1,
        });
      },
      rebase: (patch, _base, current) => {
        rebaseLabels.push(...(patch.steps[0]?.operation.labels ?? []));
        patch.steps[0]?.operation.labels.push("rebase-owned");
        return rebased({
          base: { scene_id: current.sceneId, revision: 11 },
          steps: patch.steps.map((step) => ({
            op_id: step.op_id,
            operation: { call: "increment", amount: 7, labels: ["replacement"] },
          })),
        });
      },
    });
    const handle = invokeRun(
      configuredPlanRun({
        modelClient: parked.client,
        actions,
        admissibility: (operation) => {
          operation.labels.push("admissibility-owned");
          return admissible();
        },
      }),
      shared,
      TEST_MIND_BUF,
      new AbortController().signal,
    );
    await parked.entered;
    shared.advance(testScene(5, 100));
    parked.release(incrementProposal(3));

    const result = await handle.result;

    expect(result.run_record.outcome.status).toBe("success");
    expect(rebaseLabels).toEqual(["original"]);
    expect(appliedLabels).toEqual([["original"], ["replacement"]]);
    expect(result.scene.value).toBe(107);
  });
});

describe("shared Scene replacement rejection", () => {
  test("turns replacement admissibility rejection into merge_conflict", async () => {
    const shared = authority("rebase");
    const parked = parkedModel();
    let checks = 0;
    const actions = new TestSceneActions({
      rebase: (patch, _base, current) =>
        rebased(
          {
            base: { scene_id: current.sceneId, revision: 11 },
            steps: patch.steps,
          },
          { base_revision: 999, index: 888, strategy: "fixture" },
        ),
    });
    const handle = invokeRun(
      configuredPlanRun({
        modelClient: parked.client,
        actions,
        admissibility: () => {
          checks += 1;
          return checks === 1
            ? { ok: true }
            : { ok: false, issue: validationIssue("stale_budget", "current budget rejects") };
        },
      }),
      shared,
      TEST_MIND_BUF,
      new AbortController().signal,
    );
    await parked.entered;
    shared.advance(testScene(5, 100));
    parked.release(incrementProposal());

    const result = await handle.result;

    const error = result.run_record.outcome.error;
    expect(result.run_record.outcome.status).toBe("failure");
    expect(error?.kind).toBe("merge_conflict");
    expect(error?.metadata.base_revision).toBe(10);
    expect(error?.metadata.scene_metadata).toEqual({
      base_revision: 999,
      index: 888,
      strategy: "fixture",
    });
    expect(error?.metadata.validation_error).toEqual({
      kind: "operation_admissibility",
      message: "current budget rejects",
      metadata: {
        index: 0,
        call: "increment",
        operation_id: expect.any(String),
      },
    });
    expectMergeKeys(error?.metadata ?? {}, true);
    expect(shared.read()).toEqual({ scene: testScene(5, 100), revision: 11 });
  });
});

describe("shared Scene second revision check", () => {
  test("detects a second concurrent advance before replacement installation", async () => {
    const shared = authority("rebase");
    const parked = parkedModel();
    let verifications = 0;
    const actions = new TestSceneActions({
      rebase: (patch, _base, current) =>
        rebased({
          base: { scene_id: current.sceneId, revision: 11 },
          steps: patch.steps,
        }),
      verify: () => {
        verifications += 1;
        if (verifications === 2) shared.advance(testScene(6, 200));
        return { issues: [] };
      },
    });
    const handle = invokeRun(
      configuredPlanRun({ modelClient: parked.client, actions }),
      shared,
      TEST_MIND_BUF,
      new AbortController().signal,
    );
    await parked.entered;
    shared.advance(testScene(5, 100));
    parked.release(incrementProposal());

    const result = await handle.result;

    expect(result.run_record.outcome.status).toBe("failure");
    expect(result.run_record.outcome.error?.kind).toBe("merge_conflict");
    expect(result.run_record.outcome.error?.metadata.current_live_revision).toBe(12);
    expect(result.run_record.outcome.error?.metadata.scene_metadata).toEqual({});
    expect(result.scene.value).toBe(10);
    expect(shared.read()).toEqual({ scene: testScene(6, 200), revision: 12 });
  });
});
