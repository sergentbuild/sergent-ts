import { describe, expect, test } from "bun:test";
import type { ModelClient, ModelOutcome, ModelRequest } from "sergent-ts-core";
import type { ProgressSnapshot, RunObserver, SergentResult } from "sergent-ts-observability";

import { invokeRun } from "./index.js";
import {
  configuredPlanRun,
  incrementProposal,
  scriptedModel,
  TEST_MIND_BUF,
  testScene,
  TestSceneActions,
} from "./runtime-fixtures.test.js";
import type { TestScene } from "./runtime-fixtures.test.js";

/** Creates a named observer whose callbacks append deterministic delivery facts. */
function observer(
  name: string,
  events: string[],
  onProgress?: (snapshot: ProgressSnapshot) => void,
  onFinished?: (result: SergentResult<TestScene>) => void,
): RunObserver<TestScene> {
  return {
    progress(snapshot): undefined {
      events.push(`${snapshot.stage}:${snapshot.status}:${name}`);
      onProgress?.(snapshot);
      return undefined;
    },
    finished(result): undefined {
      events.push(`finished:${name}:${result.observer_errors.length}`);
      onFinished?.(result);
      return undefined;
    },
  };
}

/** Proves one invalid adapter rejection closes as a delivered internal failure. */
async function expectContainedModelFailure(client: ModelClient): Promise<void> {
  const events: string[] = [];
  const configured = configuredPlanRun({
    modelClient: client,
    observers: [observer("watcher", events)],
  });

  const result = await invokeRun(
    configured,
    testScene(),
    TEST_MIND_BUF,
    new AbortController().signal,
  ).result;
  const step = result.run_record.steps[2];

  expect(result.run_record.outcome.status).toBe("failure");
  expect(result.run_record.outcome.error?.kind).toBe("internal_error");
  expect(result.stage).toBe("plan_call");
  expect(step?.status).toBe("failure");
  expect(step?.error).toBe(result.run_record.outcome.error);
  expect(step?.model_call).toMatchObject({
    identity: null,
    attempts: [],
    payloads: { raw_response: null, parsed_json: null, parsed_proposal: null },
  });
  expect(events.slice(-2)).toEqual(["plan_call:failure:watcher", "finished:watcher:0"]);
}

describe("runtime observer delivery", () => {
  test("preserves ordered repeated slots and accumulates contained callback failures", async () => {
    const events: string[] = [];
    const repeated = observer("repeated", events);
    const terminalFailure = observer("terminal-failure", events, (snapshot) => {
      if (snapshot.status === "success") throw new Error("progress failed");
    });
    const finishedFailure = observer("finished-failure", events, undefined, () => {
      throw new Error("finished failed");
    });
    const later = observer("later", events, undefined, (result) => {
      expect(result.observer_errors).toHaveLength(2);
    });
    const configured = configuredPlanRun({
      modelClient: scriptedModel([incrementProposal()]),
      observers: [repeated, terminalFailure, repeated, finishedFailure, later],
    });

    const result = await invokeRun(
      configured,
      testScene(),
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;

    expect(events.slice(0, 5)).toEqual([
      "queued:queued:repeated",
      "queued:queued:terminal-failure",
      "queued:queued:repeated",
      "queued:queued:finished-failure",
      "queued:queued:later",
    ]);
    expect(events.slice(-5)).toEqual([
      "finished:repeated:1",
      "finished:terminal-failure:1",
      "finished:repeated:1",
      "finished:finished-failure:1",
      "finished:later:2",
    ]);
    expect(result.observer_errors.map((error) => error.kind)).toEqual([
      "observer_error",
      "observer_error",
    ]);
    expect(result.observer_errors.map((error) => error.metadata.callback)).toEqual([
      "progress",
      "finished",
    ]);
  });
});

describe("runtime construction and process failures", () => {
  test("consumes configured runs exactly once", async () => {
    const configured = configuredPlanRun({
      modelClient: scriptedModel([incrementProposal()]),
    });
    const first = invokeRun(configured, testScene(), TEST_MIND_BUF, new AbortController().signal);

    expect(() =>
      invokeRun(configured, testScene(), TEST_MIND_BUF, new AbortController().signal),
    ).toThrow("already invoked");
    expect((await first.result).run_record.outcome.status).toBe("success");
  });

  test("uses the captured ModelClient method after external method replacement", async () => {
    const expected = incrementProposal();
    const client = scriptedModel([expected]);
    const configured = configuredPlanRun({ modelClient: client });
    client.invoke = async (_request: ModelRequest, _signal: AbortSignal): Promise<ModelOutcome> => {
      throw new Error("replacement method must not be read");
    };

    const result = await invokeRun(
      configured,
      testScene(),
      TEST_MIND_BUF,
      new AbortController().signal,
    ).result;

    expect(result.run_record.outcome.status).toBe("success");
  });

  test("rejects a pre-identity process failure without fabricating a RunRecord", async () => {
    const events: string[] = [];
    const watcher = observer("watcher", events);
    const actions = new TestSceneActions();
    actions.clone = (): TestScene => {
      throw new Error("identity unavailable");
    };
    const configured = configuredPlanRun({
      modelClient: scriptedModel([]),
      actions,
      observers: [watcher],
    });
    const handle = invokeRun(configured, testScene(), TEST_MIND_BUF, new AbortController().signal);

    expect(handle.progress).toMatchObject({
      scene_id: null,
      stage: "queued",
      status: "queued",
      revision: 0,
    });
    const rejection = await handle.result.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(rejection).toBeInstanceOf(Error);
    expect(rejection).toMatchObject({ message: "identity unavailable" });
    expect(events).toEqual(["queued:queued:watcher"]);
  });
});

describe("runtime invalid ModelClient failures", () => {
  test("contains a synchronous adapter throw after request capture", async () => {
    const client: ModelClient = {
      invoke(): Promise<ModelOutcome> {
        throw new Error("synchronous adapter defect");
      },
    };

    await expectContainedModelFailure(client);
  });

  test("contains an adapter Promise rejection after request capture", async () => {
    const client: ModelClient = {
      invoke(): Promise<ModelOutcome> {
        return Promise.reject(new Error("rejected adapter defect"));
      },
    };

    await expectContainedModelFailure(client);
  });
});
