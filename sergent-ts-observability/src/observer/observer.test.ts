import { describe, expect, test } from "bun:test";

import type { ProgressSnapshot, RunObserver, RunStage, SergentResult } from "./index.js";
import { createProgressSnapshot } from "./index.js";

/** Compile-time proof that Promise-returning callbacks cannot satisfy the contract. */
type AsyncObserverAssignable = {
  progress(snapshot: ProgressSnapshot): Promise<undefined>;
  finished(result: SergentResult): Promise<undefined>;
} extends RunObserver
  ? true
  : false;

const ASYNC_OBSERVER_ASSIGNABLE: AsyncObserverAssignable = false;

/** Stable progress identity fixture. */
const RUN_ID = "run_11111111111111111111111111111111" as const;

describe("progress and observer contracts", () => {
  test("keeps exactly five sanitized fields for every supported reached stage", () => {
    const stages: readonly RunStage[] = [
      "queued",
      "started",
      "intent_call",
      "intent",
      "plan_call",
      "execution_plan",
      "patch",
      "dry_run",
      "commit",
    ];
    const snapshots = stages.map((stage) => createProgressSnapshot(RUN_ID, null, stage, "running"));

    expect(snapshots.map((snapshot) => snapshot.stage)).toEqual([...stages]);
    expect(Object.keys(snapshots[0] ?? {})).toEqual([
      "run_id",
      "scene_id",
      "stage",
      "status",
      "revision",
    ]);
    expect(snapshots[0]).toEqual({
      run_id: RUN_ID,
      scene_id: null,
      stage: "queued",
      status: "running",
      revision: 0,
    });
  });

  test("requires synchronous callbacks that return undefined", () => {
    const calls: string[] = [];
    const observer = {
      progress: (): undefined => {
        calls.push("progress");
        return undefined;
      },
      finished: (): undefined => {
        calls.push("finished");
        return undefined;
      },
    } satisfies RunObserver;

    observer.progress();
    observer.finished();
    expect(calls).toEqual(["progress", "finished"]);
    expect(ASYNC_OBSERVER_ASSIGNABLE).toBe(false);
  });
});
