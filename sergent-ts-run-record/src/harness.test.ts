import { mkdtempSync, rmSync } from "node:fs";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "bun:test";

import { runError } from "sergent-ts-core";

import {
  createProgressSnapshot,
  createRunRecordBuilder,
  createSergentResult,
} from "sergent-ts-observability";
import type { RecordClock } from "sergent-ts-observability";
import { createRunRecordHarnessWithDependencies } from "./harness.js";
import type { HarnessDependencies } from "./harness.js";
import type { FileAdapter } from "./writer.js";
import { NODE_FILE_ADAPTER } from "./writer.js";

/** Stable run and Scene identity for boundary deduplication tests. */
const RUN_ID = "run_22222222222222222222222222222222" as const;
const SCENE = Object.freeze({
  scene_id: "scene_22222222222222222222222222222222" as const,
  revision: 3,
});

/** Creates the fixed clock used by deterministic harness tests. */
function fixedClock(): RecordClock {
  return {
    wallNow: (): Date => new Date("2026-09-01T02:03:04.005Z"),
    monotonicNow: (): number => 10,
  };
}

/** Creates a complete failed result with one reached process-input step. */
function failedResult() {
  const recordBuilder = createRunRecordBuilder(RUN_ID, "provider/model", fixedClock());
  recordBuilder.bindScene(SCENE);
  recordBuilder.startStep("process_input").addOutput("selected_target", null);
  const record = recordBuilder.fail(runError("no_target", "No target"));
  return createSergentResult(SCENE, record, "started");
}

/** Creates a full-write recording adapter and observable counters. */
function recordingFiles() {
  const state = {
    openCalls: 0,
    writeCalls: 0,
    fsyncCalls: 0,
    closeCalls: 0,
    mode: 0,
    path: "",
    text: "",
  };
  const files: FileAdapter = {
    open: (path, _flags, mode): number => {
      state.openCalls += 1;
      state.path = path;
      state.mode = mode;
      return 9;
    },
    write: (_descriptor, bytes, offset, length): number => {
      state.writeCalls += 1;
      state.text += Buffer.from(bytes.slice(offset, offset + length)).toString("ascii");
      return length;
    },
    fsync: (): void => {
      state.fsyncCalls += 1;
    },
    close: (): void => {
      state.closeCalls += 1;
    },
  };
  return { files, state };
}

/** Creates deterministic harness dependencies over one file adapter. */
function dependencies(files: FileAdapter): HarnessDependencies {
  return {
    clock: fixedClock(),
    files,
    randomHex: (): string => "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
}

test("harness deduplicates starts and writes every terminal callback", () => {
  const { files, state } = recordingFiles();
  const harness = createRunRecordHarnessWithDependencies(
    "logs",
    "sample_app",
    null,
    dependencies(files),
  );
  const started = createProgressSnapshot(RUN_ID, SCENE, "started", "running");
  const result = failedResult();

  harness.progress(started);
  harness.progress(started);
  harness.progress(createProgressSnapshot(RUN_ID, SCENE, "started", "failure"));
  harness.finished(result);
  harness.finished(result);

  expect(harness.log_id).toBe("log_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(harness.file_path).toEndWith(
    "sample_app+log_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa+20260901T020304005000Z.jsonl",
  );
  expect(state).toMatchObject({
    openCalls: 1,
    writeCalls: 3,
    fsyncCalls: 3,
    closeCalls: 0,
    mode: 0o600,
  });
  const lines: unknown[] = state.text
    .trimEnd()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  expect(lines).toEqual([
    {
      schema_version: "sergent.run_record.v1",
      timestamp_utc: "2026-09-01T02:03:04.005000Z",
      activity: "sergent_activity",
      event: "run.start",
      payload: { snapshot: started },
      run_id: RUN_ID,
      scene_id: SCENE.scene_id,
      revision: 3,
    },
    {
      schema_version: "sergent.run_record.v1",
      timestamp_utc: "2026-09-01T02:03:04.005000Z",
      activity: "sergent_activity",
      event: "run.end",
      payload: { run_record: result.run_record },
      run_id: RUN_ID,
      scene_id: SCENE.scene_id,
      revision: 3,
    },
    {
      schema_version: "sergent.run_record.v1",
      timestamp_utc: "2026-09-01T02:03:04.005000Z",
      activity: "sergent_activity",
      event: "run.end",
      payload: { run_record: result.run_record },
      run_id: RUN_ID,
      scene_id: SCENE.scene_id,
      revision: 3,
    },
  ]);
});

test.each([
  { payload: undefined, expected: {} },
  { payload: null, expected: null },
  { payload: [1, "two", null], expected: [1, "two", null] },
  { payload: "text", expected: "text" },
  { payload: 2, expected: 2 },
  { payload: false, expected: false },
  { payload: { nested: [true] }, expected: { nested: [true] } },
])("direct events persist their supplied JSON root: %j", ({ payload, expected }) => {
  const { files, state } = recordingFiles();
  const harness = createRunRecordHarnessWithDependencies(
    "logs",
    "sample_app",
    "direct",
    dependencies(files),
  );

  harness.applicationEvent(" run.end ", payload, {
    run_id: " ",
    scene_id: " scene:#1 ",
    revision: 0,
  });
  harness.userEvent("user.context", payload);

  const lines: unknown[] = state.text
    .trimEnd()
    .split("\n")
    .map((line): unknown => JSON.parse(line));
  expect(state.writeCalls).toBe(2);
  expect(lines).toEqual([
    {
      schema_version: "sergent.run_record.v1",
      timestamp_utc: "2026-09-01T02:03:04.005000Z",
      activity: "app_activity",
      event: " run.end ",
      payload: expected,
      run_id: " ",
      scene_id: " scene:#1 ",
      revision: 0,
    },
    {
      schema_version: "sergent.run_record.v1",
      timestamp_utc: "2026-09-01T02:03:04.005000Z",
      activity: "user_activity",
      event: "user.context",
      payload: expected,
    },
  ]);
});

test("harness keeps the file healthy when a direct payload fails before I/O", () => {
  const { files, state } = recordingFiles();
  const harness = createRunRecordHarnessWithDependencies(
    "logs",
    "sample_app",
    "manual",
    dependencies(files),
  );
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  expect(() => harness.applicationEvent("bad", { value: Number.NaN })).toThrow();
  expect(() => harness.userEvent("bad", cyclic)).toThrow();
  harness.applicationEvent("app.changed", undefined, { scene_id: SCENE.scene_id, revision: 3 });

  expect(state.writeCalls).toBe(1);
  expect(state.fsyncCalls).toBe(1);
  expect(state.text).toBe(
    '{"activity":"app_activity","event":"app.changed","payload":{},"revision":3,' +
      `"scene_id":"${SCENE.scene_id}","schema_version":"sergent.run_record.v1",` +
      '"timestamp_utc":"2026-09-01T02:03:04.005000Z"}\n',
  );
});

test("harness refuses an existing final path without truncation", () => {
  const directory = mkdtempSync(join(tmpdir(), "sergent-observability-"));
  const selectedDependencies = dependencies(NODE_FILE_ADAPTER);
  const first = createRunRecordHarnessWithDependencies(
    directory,
    "sample_app",
    "exclusive",
    selectedDependencies,
  );
  try {
    expect(() =>
      createRunRecordHarnessWithDependencies(
        directory,
        "sample_app",
        "exclusive",
        selectedDependencies,
      ),
    ).toThrow();
  } finally {
    first.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("disabled direct events report the first persistence failure before conversion", () => {
  const firstFailure = new Error("disk failed");
  let writeCalls = 0;
  let closeCalls = 0;
  const files: FileAdapter = {
    open: (): number => 10,
    write: (): never => {
      writeCalls += 1;
      throw firstFailure;
    },
    fsync: (): void => undefined,
    close: (): void => {
      closeCalls += 1;
    },
  };
  const harness = createRunRecordHarnessWithDependencies(
    "logs",
    "sample_app",
    "disabled",
    dependencies(files),
  );
  expect(() => harness.applicationEvent("first")).toThrow("disk failed");

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  for (const payload of [cyclic, { value: Number.NaN }]) {
    try {
      harness.userEvent("later", payload);
      throw new Error("Expected disabled harness failure");
    } catch (reason) {
      if (!(reason instanceof Error)) throw reason;
      expect(reason.message).toContain("unavailable");
      expect(reason.cause).toBe(firstFailure);
    }
  }
  expect(writeCalls).toBe(1);
  expect(closeCalls).toBe(1);
});
