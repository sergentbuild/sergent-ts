import { expect, test } from "bun:test";

import {
  createFailedModelAttempt,
  createModelFailure,
  createTransportError,
} from "sergent-ts-core";
import type { ModelTokens } from "sergent-ts-core";

import { ModelCallRecordBuilder, RunRecordBuilder } from "./index.js";
import {
  MODEL_IDENTITY,
  recordProcessInput,
  requestFixture,
  RUN_ID,
  SCENE,
  successfulOutcome,
  tickingClock,
} from "./recording-fixtures.test.js";

/** Reported usage mappings from the provider-owned whole-call outcome. */
const REPORTED_COUNTS: readonly (ModelTokens | null)[] = [
  { input: 2, output: 1 },
  { input: 0 },
  { output: 0 },
  null,
];

test.each([...REPORTED_COUNTS])(
  "model-call records preserve exactly reported tokens: %j",
  (tokens) => {
    const call = new ModelCallRecordBuilder(requestFixture());
    call.complete({
      ...successfulOutcome(),
      usage: { latencyMs: 9, tokens, requestId: "req-1" },
    });
    call.recordParsedProposal({ decision: "continue" });
    expect(call.close("success", null).usage).toEqual({
      latency_ms: 9,
      tokens,
      request_id: "req-1",
    });
  },
);

test("response-backed provider failure retains every reached response fact", () => {
  const recording = new RunRecordBuilder(RUN_ID, "provider/model", tickingClock());
  recording.bindScene(SCENE);
  recordProcessInput(recording);
  const intent = recording.startStep("intent");
  const providerError = createTransportError("invalid_response", "Provider response failed");
  const attempt = createFailedModelAttempt(
    {
      startedAt: "2026-09-01T00:00:03.000000Z",
      finishedAt: "2026-09-01T00:00:03.006000Z",
      durationMs: 6,
    },
    providerError,
  );
  const response = {
    rawResponse: '{"decision":"partial"}',
    parsedJson: { decision: "partial" },
    usage: { latencyMs: 8, tokens: { output: 0 }, requestId: "req-2" },
  };
  intent
    .openModelCall(requestFixture())
    .complete(createModelFailure(MODEL_IDENTITY, [attempt], response));
  intent.fail(providerError);
  const record = recording.fail(providerError);

  expect(record.steps).toHaveLength(2);
  expect(record.steps[1]?.model_call).toMatchObject({
    payloads: {
      raw_response: '{"decision":"partial"}',
      parsed_json: { decision: "partial" },
      parsed_proposal: null,
    },
    usage: { latency_ms: 8, tokens: { output: 0 }, request_id: "req-2" },
    attempts: [{ status: "failure", retryable: false, error: providerError }],
  });
});
