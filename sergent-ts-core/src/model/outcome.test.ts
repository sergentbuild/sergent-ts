import { describe, expect, expectTypeOf, test } from "bun:test";

import type { JsonObject } from "../values/index.js";
import { cancelledError } from "../values/index.js";
import {
  createFailedModelAttempt,
  createModelCancellation,
  createModelFailure,
  createModelSuccess,
  createPreAttemptModelFailure,
  createSuccessfulModelAttempt,
  createTransportError,
} from "./index.js";
import type {
  FailedModelAttempt,
  ModelCancellation,
  ModelFailure,
  ModelSuccess,
  SuccessfulModelAttempt,
  TransportFailureKind,
} from "./index.js";

/** Representative closed attempt timing. */
const timing = {
  startedAt: "2026-09-01T00:00:00.000000Z",
  finishedAt: "2026-09-01T00:00:00.001000Z",
  durationMs: 1,
};

/** Representative resolved provider identity. */
const identity = {
  provider: "example",
  model: "model",
  sdkPackage: "example-sdk",
  sdkVersion: "1.0.0",
};

/** Representative complete call usage. */
const usage = { latencyMs: 2, tokens: { input: 1, output: 2 }, requestId: "request-1" };

/** A forbidden retryable missing-credentials attempt. */
type RetryableMissingCredentials = Extract<
  FailedModelAttempt,
  { readonly retryable: true; readonly error: { readonly kind: "missing_credentials" } }
>;

/** Whether a three-row sequence can inhabit successful outcome attempts. */
type ThreeSuccessRowsAccepted = readonly [
  SuccessfulModelAttempt,
  SuccessfulModelAttempt,
  SuccessfulModelAttempt,
] extends ModelSuccess["attempts"]
  ? true
  : false;

/** Whether success can claim that no provider attempt completed. */
type ZeroSuccessRowsAccepted = readonly [] extends ModelSuccess["attempts"] ? true : false;

/** A forbidden response-less failure that nevertheless carries parsed JSON. */
type ResponseLessParsedFailure = Extract<
  ModelFailure,
  { readonly rawResponse: null; readonly parsedJson: JsonObject }
>;

/** A forbidden response-backed failure without its correlated usage. */
type ResponseWithoutUsageFailure = Extract<
  ModelFailure,
  { readonly rawResponse: string; readonly usage: null }
>;

/** Whether cancellation may retain two completed retry failures. */
type TwoCancellationRowsAccepted = readonly [
  FailedModelAttempt,
  FailedModelAttempt,
] extends ModelCancellation["attempts"]
  ? true
  : false;

describe("model transport attempt construction", () => {
  test("derive authoritative retryability metadata while preserving caller facts", () => {
    const retryableOmitted = createTransportError("timeout", "late");
    const retryableContradicted = createTransportError("rate_limited", "busy", {
      retryable: false,
      provider_status: 429,
    });
    const terminalOmitted = createTransportError("missing_credentials", "missing");
    const terminalContradicted = createTransportError("invalid_response", "bad", {
      retryable: true,
      response_stage: "parse",
    });

    expect(retryableOmitted.metadata).toEqual({ retryable: true });
    expect(retryableContradicted.metadata).toEqual({
      retryable: true,
      provider_status: 429,
    });
    expect(terminalOmitted.metadata).toEqual({ retryable: false });
    expect(terminalContradicted.metadata).toEqual({
      retryable: false,
      response_stage: "parse",
    });

    const attempts = [
      createFailedModelAttempt(timing, retryableOmitted),
      createFailedModelAttempt(timing, retryableContradicted),
      createFailedModelAttempt(timing, terminalOmitted),
      createFailedModelAttempt(timing, terminalContradicted),
    ];
    for (const attempt of attempts) {
      expect(attempt.error.metadata.retryable).toBe(attempt.retryable);
    }
  });

  test("bind retryability to the closed transport error kind", () => {
    const retryable = createFailedModelAttempt(
      timing,
      createTransportError("provider_unavailable", "offline"),
    );
    const terminal = createFailedModelAttempt(
      timing,
      createTransportError("missing_credentials", "missing"),
    );

    expect(retryable.retryable).toBe(true);
    expect(terminal.retryable).toBe(false);
    expect(() =>
      createFailedModelAttempt(
        timing,
        structuredClone(createTransportError("timeout", "unbranded clone")),
      ),
    ).toThrow(TypeError);
    expect(() => Reflect.apply(createTransportError, null, ["arbitrary", "bad"])).toThrow(
      TypeError,
    );
    expectTypeOf<"arbitrary" extends TransportFailureKind ? true : false>().toEqualTypeOf<false>();
    expectTypeOf<RetryableMissingCredentials>().toEqualTypeOf<never>();
  });
});

describe("model success and failure state construction", () => {
  test("require one success or one retryable failure followed by success", () => {
    const success = createSuccessfulModelAttempt(timing);
    const retry = createFailedModelAttempt(timing, createTransportError("timeout", "late"));

    expect(createModelSuccess(identity, [success], "{}", {}, usage).attempts).toHaveLength(1);
    expect(createModelSuccess(identity, [retry, success], "{}", {}, usage).attempts).toHaveLength(
      2,
    );
    expect(() => createModelSuccess(identity, [], "{}", {}, usage)).toThrow(TypeError);
    expect(() => createModelSuccess(identity, [success, success], "{}", {}, usage)).toThrow(
      TypeError,
    );
    expect(() => createModelSuccess(identity, [retry, retry, success], "{}", {}, usage)).toThrow(
      TypeError,
    );
    expect(() =>
      createModelSuccess(identity, [structuredClone(retry), success], "{}", {}, usage),
    ).toThrow(TypeError);
    expectTypeOf<ThreeSuccessRowsAccepted>().toEqualTypeOf<false>();
    expectTypeOf<ZeroSuccessRowsAccepted>().toEqualTypeOf<false>();
  });

  test("separate pre-attempt, response-less, and response-backed failures", () => {
    const missing = createTransportError("missing_credentials", "missing");
    const timeout = createTransportError("timeout", "late");
    const invalid = createFailedModelAttempt(
      timing,
      createTransportError("invalid_response", "bad JSON"),
    );
    const preAttempt = createPreAttemptModelFailure(missing);
    const responseLess = createModelFailure(identity, [createFailedModelAttempt(timing, timeout)]);
    const responseBacked = createModelFailure(identity, [invalid], {
      rawResponse: "not-json",
      parsedJson: null,
      usage,
    });

    expect(preAttempt.attempts).toHaveLength(0);
    expect(preAttempt.rawResponse).toBeNull();
    expect(responseLess.parsedJson).toBeNull();
    expect(responseLess.usage).toBeNull();
    expect(responseBacked.rawResponse).toBe("not-json");
    expect(responseBacked.usage).toBe(usage);
    expect(() => createPreAttemptModelFailure(timeout)).toThrow(TypeError);
    expect(() => createModelFailure(identity, [])).toThrow(TypeError);
    expectTypeOf<ResponseLessParsedFailure>().toEqualTypeOf<never>();
    expectTypeOf<ResponseWithoutUsageFailure>().toEqualTypeOf<never>();
  });
});

describe("model cancellation state construction", () => {
  test("retain at most one retryable completed attempt and no partial response", () => {
    const retry = createFailedModelAttempt(timing, createTransportError("rate_limited", "busy"));
    const terminal = createFailedModelAttempt(
      timing,
      createTransportError("model_not_found", "gone"),
    );
    const cancellation = createModelCancellation(cancelledError("cancelled"), identity, [retry]);

    expect(cancellation.attempts).toEqual([retry]);
    expect(cancellation.rawResponse).toBeNull();
    expect(cancellation.parsedJson).toBeNull();
    expect(cancellation.usage).toBeNull();
    expect(() => createModelCancellation(cancelledError("cancelled"), null, [retry])).toThrow(
      TypeError,
    );
    expect(() =>
      createModelCancellation(cancelledError("cancelled"), identity, [terminal]),
    ).toThrow(TypeError);
    expect(() =>
      createModelCancellation(cancelledError("cancelled"), identity, [retry, retry]),
    ).toThrow(TypeError);
    expectTypeOf<TwoCancellationRowsAccepted>().toEqualTypeOf<false>();
  });
});
