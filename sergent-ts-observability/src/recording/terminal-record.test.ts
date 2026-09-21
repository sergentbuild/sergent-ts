import { expect, test } from "bun:test";

import type { JsonObject } from "sergent-ts-core";

import { createSergentResult } from "../observer/index.js";
import type { SuccessfulRunRecord } from "../records/index.js";
import { RunRecordBuilder } from "./index.js";
import type { TerminalFacts } from "./index.js";
import { recordProcessInput, RUN_ID, SCENE, tickingClock } from "./recording-fixtures.test.js";

/** Closes a stop Intent with the terminal facts supplied by runtime. */
function closeStop(terminal: TerminalFacts | null): SuccessfulRunRecord {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  intent.addOutput("derived_intent", { flow: "stop" });
  intent.addOutput("flow", "stop");
  return recording.succeed(SCENE.revision, terminal);
}

/** Represents an application value whose property cannot be captured. */
function unconvertibleFact(): object {
  return Object.defineProperty({}, "value", {
    enumerable: true,
    get: (): never => {
      throw new Error("Application value cannot be projected");
    },
  });
}

/** Independent success facts with exact JSON metadata in every case. */
const TERMINAL_CASES: readonly Readonly<{ message: string | null; metadata: JsonObject }>[] = [
  { message: "done", metadata: {} },
  { message: null, metadata: { decision: "keep" } },
  { message: "done", metadata: { decision: "keep" } },
];

test.each([...TERMINAL_CASES])(
  "terminal facts retain both exact capture envelopes: %j",
  (facts) => {
    const record = closeStop(facts);
    expect(record.outcome.terminal).toEqual({
      message: {
        value: facts.message,
        value_type: expect.any(String),
        error: null,
        status: "captured",
      },
      metadata: {
        value: facts.metadata,
        value_type: expect.any(String),
        error: null,
        status: "captured",
      },
    });
    const result = createSergentResult(SCENE, record, "intent");
    expect(result.terminal_message).toBe(facts.message);
    expect(result.terminal_metadata).toEqual(facts.metadata);
  },
);

test.each([null, { message: null, metadata: {} }])(
  "absent terminal facts keep the whole terminal record null: %j",
  (facts) => {
    const record = closeStop(facts);
    const result = createSergentResult(SCENE, record, "intent");
    expect(record.outcome.terminal).toBeNull();
    expect(result.terminal_message).toBeNull();
    expect(result.terminal_metadata).toEqual({});
  },
);

test.each(["message", "metadata"] as const)(
  "a failed terminal %s capture preserves the other fact",
  (field) => {
    const unconvertible = unconvertibleFact();
    const record = closeStop({
      message: field === "message" ? unconvertible : "kept",
      metadata: field === "metadata" ? unconvertible : { kept: true },
    });
    const terminal = record.outcome.terminal;
    if (terminal === null) throw new Error("Expected terminal evidence");
    expect(terminal[field]).toMatchObject({
      value: null,
      status: "capture_error",
      error: { kind: "capture_error" },
    });
    const neighbor = field === "message" ? terminal.metadata : terminal.message;
    expect(neighbor).toEqual({
      value: field === "message" ? { kept: true } : "kept",
      value_type: expect.any(String),
      error: null,
      status: "captured",
    });
    const result = createSergentResult(SCENE, record, "intent");
    expect(result.terminal_message).toBe(field === "message" ? null : "kept");
    expect(result.terminal_metadata).toEqual(field === "metadata" ? {} : { kept: true });
  },
);

test("a failed message capture remains evidence beside empty metadata", () => {
  const record = closeStop({ message: unconvertibleFact(), metadata: {} });
  expect(record.outcome.terminal).toMatchObject({
    message: { value: null, status: "capture_error", error: { kind: "capture_error" } },
    metadata: { value: {}, status: "captured", error: null },
  });
});
