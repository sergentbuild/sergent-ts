import { expect, test } from "bun:test";

import { cancelledError, runError } from "sergent-ts-core";

import { RunRecordBuilder } from "./run.js";
import {
  recordDeterministicTail,
  recordIntent,
  recordProcessInput,
  requestFixture,
  RUN_ID,
  SCENE,
  successfulOutcome,
  tickingClock,
} from "./recording-fixtures.test.js";

test("a failed child permits only the matching failed run terminal", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  const childError = runError("child_failure", "Child failed");
  recording.startStep("process_input").fail(childError);

  expect(() => recording.startStep("intent")).toThrow("terminal child");
  expect(() => recording.succeed(SCENE.revision)).toThrow("cannot close as success");
  expect(() => recording.cancel(cancelledError("wrong terminal"), null)).toThrow(
    "must close as failure",
  );
  expect(recording.fail(childError).outcome).toEqual({
    status: "failure",
    error: childError,
    terminal: null,
  });
});

test("a cancelled child permits only the matching cancelled run terminal", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  const childError = cancelledError("Child cancelled");
  recording.startStep("process_input").cancel(childError);

  expect(() => recording.fail(runError("wrong_terminal", "Wrong terminal"))).toThrow(
    "must close as cancelled",
  );
  expect(recording.cancel(childError, "before_intent").outcome.status).toBe("cancelled");
});

test("completed commit rejects failure while cancellation between steps remains valid", () => {
  const committed = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  committed.bindScene(SCENE);
  recordProcessInput(committed);
  recordIntent(committed);
  recordDeterministicTail(committed);

  expect(() => committed.fail(runError("late_failure", "Too late"))).toThrow("completed commit");
  expect(() => committed.cancel(cancelledError("too late"), null)).toThrow("completed commit");
  expect(committed.succeed(8).outcome.status).toBe("success");

  const betweenSteps = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  betweenSteps.bindScene(SCENE);
  recordProcessInput(betweenSteps);
  const cancelled = betweenSteps.cancel(cancelledError("between steps"), "before_intent");
  expect(cancelled.steps).toHaveLength(1);
  expect(cancelled.steps[0]?.status).toBe("success");
});

test("closed Step Records retain owned evidence when later work is cancelled", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  const call = intent.openModelCall(requestFixture());
  const parsed = { decision: "continue" };
  const derived = { flow: "continue", reason: "needed" };
  call.complete({ ...successfulOutcome(), parsedJson: parsed });
  call.recordParsedProposal(parsed);
  intent.addOutput("derived_intent", derived);
  intent.addOutput("flow", "continue");
  intent.succeed();

  parsed.decision = "stop";
  derived.reason = "changed after capture";
  expect(() => intent.addOutput("flow", "stop")).toThrow("already closed");
  expect(() => call.complete(successfulOutcome())).toThrow("already settled");
  recording.startStep("execution_plan").openModelCall(requestFixture()).interrupt();
  const record = recording.cancel(cancelledError("Plan interrupted"), "task_cancelled");

  expect(record.steps).toHaveLength(3);
  expect(record.steps[1]).toMatchObject({
    status: "success",
    output: {
      status: "captured",
      value: { derived_intent: { flow: "continue", reason: "needed" }, flow: "continue" },
    },
    model_call: {
      payloads: {
        parsed_json: { decision: "continue" },
        parsed_proposal: { status: "captured", value: { decision: "continue" } },
      },
    },
  });
  expect(record.steps[2]).toMatchObject({
    status: "cancelled",
    model_call: { identity: null, usage: null, attempts: [] },
  });
});
