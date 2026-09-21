import { expect, test } from "bun:test";

import {
  cancelledError,
  createFailedModelAttempt,
  createModelCancellation,
  createModelFailure,
  createPreAttemptModelFailure,
  createTransportError,
  runError,
  schemaValidationError,
} from "sergent-ts-core";

import { createSergentResult } from "../observer/index.js";
import type { SergentResult } from "../observer/index.js";
import type { SuccessfulRunRecord } from "../records/index.js";
import { ModelCallRecordBuilder } from "./model-call.js";
import { RunRecordBuilder } from "./run.js";
import {
  expectedProposalSchema,
  expectedRequestCapture,
  expectedSuccessfulModelCall,
  MODEL_IDENTITY,
  recordDeterministicTail,
  recordIntent,
  recordProcessInput,
  requestFixture,
  RUN_ID,
  SCENE,
  successfulOutcome,
  tickingClock,
} from "./recording-fixtures.test.js";

/** Verifies the complete public evidence of one successful scenario. */
function verifySuccessfulRun(
  record: SuccessfulRunRecord,
  result: SergentResult<{ readonly revision: number }>,
): void {
  expect(record.scene).toEqual({
    scene_id: SCENE.scene_id,
    revision_before: 7,
    revision_after: 8,
  });
  expect(record.steps.map((step) => step.name)).toEqual([
    "process_input",
    "intent",
    "execution_plan",
    "patch",
    "commit",
  ]);
  expect(record.steps.every((step) => step.status === "success")).toBe(true);
  expect(record.timing).toEqual({
    started_at: "2026-09-01T00:00:00.000000Z",
    finished_at: "2026-09-01T00:00:00.011000Z",
    duration_ms: 11,
  });
  expect(record.steps[1]?.model_call).toEqual(
    expectedSuccessfulModelCall({
      value: { decision: "continue" },
      value_type: "Object",
      error: null,
      status: "captured",
    }),
  );
  expect(record.outcome).toMatchObject({ status: "success", error: null });
  expect(result).toMatchObject({
    stage: "commit",
    terminal_message: "done",
    terminal_metadata: { changed: true },
    observer_errors: [],
  });
}

/** Creates an application value whose enumerable property cannot be captured. */
function unconvertibleValue(message: string): object {
  return Object.defineProperty({}, "bad", {
    enumerable: true,
    get: (): never => {
      throw new Error(message);
    },
  });
}

test("recording closes a full successful run with exact evidence", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  recordIntent(recording);
  recordDeterministicTail(recording);
  const record = recording.succeed(8, { message: "done", metadata: { changed: true } });
  const result = createSergentResult({ revision: 8 }, record, "commit");
  verifySuccessfulRun(record, result);
});

test("recording closes a stop Intent without model or revision change", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  intent.addOutput("derived_intent", { flow: "stop" });
  intent.addOutput("flow", "stop");
  const record = recording.succeed(SCENE.revision, { message: "nothing to do", metadata: {} });

  expect(record.scene.revision_after).toBe(SCENE.revision);
  expect(record.steps).toHaveLength(2);
  expect(record.steps[1]?.model_call).toBeNull();
});

test("recording closes failure and cancellation with state-safe terminal relations", () => {
  const failure = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  failure.bindScene(SCENE);
  const failedStep = failure.startStep("process_input");
  failedStep.addOutput("selected_target", null);
  const noTarget = runError("no_target", "No target");
  const failedRecord = failure.fail(noTarget);
  const failedResult = createSergentResult(SCENE, failedRecord, "started");

  expect(failedRecord).toMatchObject({
    scene: { revision_after: null },
    steps: [{ status: "failure", error: noTarget }],
    outcome: { status: "failure", error: noTarget, terminal: null },
    cancellation: null,
  });
  expect(failedResult).toMatchObject({
    terminal_message: "No target",
    terminal_metadata: {},
  });

  const cancellation = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  cancellation.bindScene(SCENE);
  cancellation.startStep("process_input").succeed();
  cancellation.startStep("intent");
  const cancelled = cancelledError("Stopped by caller");
  const cancelledRecord = cancellation.cancel(cancelled, "after_intent_validation");
  const cancelledResult = createSergentResult(SCENE, cancelledRecord, "intent");

  expect(cancelledRecord).toMatchObject({
    scene: { revision_after: null },
    steps: [{ status: "success" }, { status: "cancelled", error: cancelled }],
    outcome: { status: "cancelled", error: cancelled, terminal: null },
    cancellation: {
      requested_at: "2026-09-01T00:00:00.004000Z",
      checkpoint: "after_intent_validation",
    },
  });
  expect(cancelledResult).toMatchObject({
    terminal_message: "Stopped by caller",
    terminal_metadata: {},
  });
});

test("failed merged output capture displaces every earlier merged fact", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  const step = recording.startStep("process_input");
  step.addOutput("selected_target", { target_id: "item-1" });
  step.addOutput("neighbor", unconvertibleValue("permanent"));
  step.succeed();
  const record = recording.fail(runError("later_failure", "Later failure"));

  expect(record.steps).toHaveLength(1);
  expect(record.steps[0]?.output).toMatchObject({
    value: null,
    status: "capture_error",
    error: { kind: "capture_error" },
  });
});

test("recording recaptures complete merged output and recovers after replacement", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  const step = recording.startStep("process_input");
  expect(() => step.openModelCall(requestFixture())).toThrow("Only Intent");
  step.addOutput("selected_target", unconvertibleValue("temporary"));
  step.addOutput("selected_target", { target_id: "item-1" });
  step.addOutput("neighbor", "kept");
  step.succeed();
  const record = recording.fail(runError("later_failure", "Later failure"));

  expect(record.steps[0]?.output).toEqual({
    value: { selected_target: { target_id: "item-1" }, neighbor: "kept" },
    value_type: "Object",
    error: null,
    status: "captured",
  });
});

test("proposal recording rejects every non-successful model outcome", () => {
  const interrupted = new ModelCallRecordBuilder(requestFixture());
  interrupted.interrupt();
  expect(() => interrupted.recordParsedProposal({ decision: "continue" })).toThrow(
    "successful provider outcome",
  );

  const failureError = createTransportError("invalid_payload", "Invalid request");
  const failed = new ModelCallRecordBuilder(requestFixture());
  failed.complete(createPreAttemptModelFailure(failureError));
  expect(() => failed.recordParsedProposal({ decision: "continue" })).toThrow(
    "successful provider outcome",
  );

  const cancelled = new ModelCallRecordBuilder(requestFixture());
  cancelled.complete(createModelCancellation(cancelledError("Caller cancelled"), null));
  expect(() => cancelled.recordParsedProposal({ decision: "continue" })).toThrow(
    "successful provider outcome",
  );

  const successful = new ModelCallRecordBuilder(requestFixture());
  successful.complete(successfulOutcome());
  successful.recordParsedProposal({ decision: "continue" });
  expect(() => successful.recordParsedProposal({ decision: "again" })).toThrow("already recorded");
});

test("open model calls cannot be closed by an enclosing step", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  const call = intent.openModelCall(requestFixture());
  const providerError = createTransportError("invalid_payload", "Invalid request");

  expect(() => intent.fail(providerError)).toThrow("settle or be interrupted explicitly");
  call.complete(createPreAttemptModelFailure(providerError));
  intent.fail(providerError);
  const record = recording.fail(providerError);
  expect(record.steps[1]?.model_call).toEqual({
    proposal_schema: expectedProposalSchema(),
    model_name: "provider/model",
    identity: null,
    payloads: {
      request: expectedRequestCapture(),
      raw_response: null,
      parsed_json: null,
      parsed_proposal: null,
    },
    usage: null,
    attempts: [],
  });
});

test("provider failure requires its exact outcome error without consuming closure", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  const providerError = createTransportError("provider_error", "Provider rejected request");
  const attempt = createFailedModelAttempt(
    Object.freeze({
      startedAt: "2026-09-01T00:00:03.000000Z",
      finishedAt: "2026-09-01T00:00:03.006000Z",
      durationMs: 6,
    }),
    providerError,
  );
  intent.openModelCall(requestFixture()).complete(createModelFailure(MODEL_IDENTITY, [attempt]));
  const unrelated = createTransportError("provider_error", "Unrelated provider error");

  expect(() => intent.fail(unrelated)).toThrow("exact provider outcome error");
  intent.fail(providerError);
  const record = recording.fail(providerError);
  expect(record.steps[1]?.error).toBe(providerError);
  expect(record.steps[1]?.model_call?.attempts[0]?.error).toBe(providerError);
  expect(record.outcome.error).toBe(providerError);
});

test("interrupted model calls cancel with the exact request-only record", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  const call = intent.openModelCall(requestFixture());
  call.interrupt();
  expect(() => intent.succeed()).toThrow("requires a cancelled step");
  const error = cancelledError("Transport interrupted");
  intent.cancel(error);
  expect(() => recording.succeed(SCENE.revision)).toThrow("cannot close as success");
  const record = recording.cancel(error, "task_cancelled");

  expect(record.steps[1]?.model_call).toEqual({
    proposal_schema: expectedProposalSchema(),
    model_name: "provider/model",
    identity: null,
    payloads: {
      request: expectedRequestCapture(),
      raw_response: null,
      parsed_json: null,
      parsed_proposal: null,
    },
    usage: null,
    attempts: [],
  });
});

test("schema-crossing failure retains successful provider evidence without a proposal", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  intent.openModelCall(requestFixture()).complete(successfulOutcome());
  const error = schemaValidationError("Proposal did not match schema");
  intent.fail(error);
  const record = recording.fail(error);

  expect(record.steps[1]?.model_call).toEqual(expectedSuccessfulModelCall(null));
});

test("successful ExecutionPlan step requires a completed typed proposal call", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  recordIntent(recording);
  const plan = recording.startStep("execution_plan");
  expect(() => plan.succeed()).toThrow("requires a model call");

  const call = plan.openModelCall(requestFixture());
  call.complete(successfulOutcome());
  expect(() => plan.succeed()).toThrow("recorded typed proposal");
  call.recordParsedProposal({ operations: [{ call: "replace", value: "new" }] });
  plan.succeed();
  expect(recording.fail(runError("later_failure", "Later failure")).steps[2]?.status).toBe(
    "success",
  );
});

test("provider cancellation retains completed retry evidence exactly", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  const timeout = createTransportError("timeout", "First attempt timed out");
  const retry = createFailedModelAttempt(
    Object.freeze({
      startedAt: "2026-09-01T00:00:02.000000Z",
      finishedAt: "2026-09-01T00:00:02.010000Z",
      durationMs: 10,
    }),
    timeout,
  );
  const error = cancelledError("Caller cancelled retry");
  const call = intent.openModelCall(requestFixture());
  call.complete(createModelCancellation(error, MODEL_IDENTITY, [retry]));
  expect(() => call.recordParsedProposal({ decision: "continue" })).toThrow(
    "successful provider outcome",
  );
  expect(() => intent.cancel(cancelledError("Unrelated cancellation"))).toThrow(
    "exact provider outcome error",
  );
  intent.cancel(error);
  const record = recording.cancel(error, "task_cancelled");

  expect(record.steps[1]?.model_call).toEqual({
    proposal_schema: expectedProposalSchema(),
    model_name: "provider/model",
    identity: {
      provider: "provider",
      model: "model",
      sdk_package: "provider-sdk",
      sdk_version: "1.2.3",
    },
    payloads: {
      request: expectedRequestCapture(),
      raw_response: null,
      parsed_json: null,
      parsed_proposal: null,
    },
    usage: null,
    attempts: [
      {
        timing: {
          started_at: "2026-09-01T00:00:02.000000Z",
          finished_at: "2026-09-01T00:00:02.010000Z",
          duration_ms: 10,
        },
        status: "failure",
        retryable: true,
        error: timeout,
      },
    ],
  });
  expect(record.steps[1]?.error).toBe(error);
  expect(record.steps[1]?.model_call?.attempts[0]?.error).toBe(timeout);
  expect(record.outcome.error).toBe(error);
});
