import { describe, expect, test } from "bun:test";
import type { ProgressSnapshot } from "sergent-ts-observability";

import { invokeRun } from "./index.js";
import {
  configuredPlanRun,
  progressRecorder,
  scriptedModel,
  TEST_MIND_BUF,
  testScene,
  TestSceneActions,
} from "./runtime-fixtures.test.js";

describe("runtime terminal paths", () => {
  test("ends at started with the Recipe no-target error and no model call", async () => {
    const client = scriptedModel([]);
    const progress: ProgressSnapshot[] = [];
    const configured = configuredPlanRun({
      modelClient: client,
      actions: new TestSceneActions({ selectTarget: () => null }),
      observers: [progressRecorder(progress)],
    });

    const result = await invokeRun(
      configured,
      testScene(),
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;

    expect(result.run_record.outcome.status).toBe("failure");
    expect(result.run_record.outcome.error?.kind).toBe("no_target");
    expect(result.stage).toBe("started");
    expect(result.run_record.steps.map((step) => step.name)).toEqual(["process_input"]);
    expect(client.requests).toHaveLength(0);
    expect(progress.map(({ stage, status }) => [stage, status])).toEqual([
      ["queued", "queued"],
      ["started", "running"],
      ["started", "failure"],
    ]);
  });

  test("runs pass-through stop without a provider or mutation", async () => {
    const client = scriptedModel([]);
    const before = testScene();
    const configured = configuredPlanRun({ modelClient: client, intentFlow: "stop" });

    const result = await invokeRun(configured, before, TEST_MIND_BUF, new AbortController().signal)
      .result;

    expect(result.run_record.outcome.status).toBe("success");
    expect(result.stage).toBe("intent");
    expect(result.scene).toEqual(before);
    expect(result.scene).not.toBe(before);
    expect(result.run_record.scene.revision_after).toBe(before.revision);
    expect(result.terminal_message).toBe("stopped");
    expect(result.terminal_metadata).toEqual({ source: "fixture" });
    expect(result.run_record.steps.map((step) => step.name)).toEqual(["process_input", "intent"]);
    expect(client.requests).toHaveLength(0);
  });
});

describe("runtime stop terminal facts", () => {
  test("omits the terminal record when the stop supplies no facts", async () => {
    const result = await invokeRun(
      configuredPlanRun({
        modelClient: scriptedModel([]),
        intentFlow: "stop",
        stopTerminal: { data: null, metadata: {} },
      }),
      testScene(),
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;

    expect(result.run_record.outcome.status).toBe("success");
    expect(result.stage).toBe("intent");
    expect(result.terminal_message).toBeNull();
    expect(result.terminal_metadata).toEqual({});
    expect(result.run_record.outcome.terminal).toBeNull();
  });
});
