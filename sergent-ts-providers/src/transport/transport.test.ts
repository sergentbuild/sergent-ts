import { describe, expect, test } from "bun:test";
import {
  Type,
  createMessages,
  createModelRequest,
  createModelSettings,
  createPreAttemptModelFailure,
  createProposalDefinition,
  createTransportError,
  createUserMessage,
} from "sergent-ts-core";
import type { ModelIdentity, ModelRequest, TransportError } from "sergent-ts-core";
import {
  createTransportClient,
  executeTransport,
  isExternalObject,
  isTokenCount,
  sdkSchemaRecord,
  startTransportCall,
} from "./index.js";
import type { NativeAdmission } from "./index.js";
import type { TransportClock } from "./types.js";

const IDENTITY: ModelIdentity = Object.freeze({
  provider: "test",
  model: "model",
  sdkPackage: "test-sdk",
  sdkVersion: "1.0.0",
});

/** Creates one portable request for the shared client lifecycle test. */
function modelRequest(): ModelRequest {
  const proposal = createProposalDefinition(
    "TestProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  return createModelRequest(
    "test/model",
    createMessages([createUserMessage("test")]),
    proposal.proposal_schema,
    createModelSettings(32, 100, "low"),
  );
}

/** Creates deterministic timing without sleeping or ambient wall time. */
function clock(timeoutSignal = new AbortController().signal): TransportClock {
  let monotonic = 0;
  return {
    wallNow: () => new Date("2026-09-01T00:00:00.123Z"),
    monotonicNow: () => {
      monotonic += 5;
      return monotonic;
    },
    timeoutSignal: () => timeoutSignal,
  };
}

/** Creates a clock whose monotonic readings prove exact lifecycle placement. */
function scriptedClock(readings: readonly number[]): TransportClock {
  let index = 0;
  return {
    wallNow: () => new Date("2026-09-01T00:00:00.123Z"),
    monotonicNow: () => readings[index++] ?? readings.at(-1) ?? 0,
    timeoutSignal: () => new AbortController().signal,
  };
}

/** Creates an admitted response with complete portable evidence. */
function admitted(rawResponse = '{"answer":"yes"}'): NativeAdmission {
  return {
    status: "admitted",
    response: {
      rawResponse,
      tokens: { input: 3, output: 2 },
      requestId: "request-1",
    },
  };
}

/** Runs shared transport with deterministic defaults and the supplied invocation. */
function run(
  invoke: (signal: AbortSignal) => Promise<NativeAdmission>,
  callerSignal = new AbortController().signal,
  testClock = clock(),
  classify: (error: unknown) => TransportError = () =>
    createTransportError("provider_error", "classified"),
  timeoutMs = 100,
) {
  return executeTransport({
    call: startTransportCall(testClock),
    identity: IDENTITY,
    timeoutMs,
    callerSignal,
    invoke,
    classify,
  });
}

describe("shared provider boundary primitives", () => {
  test("narrows only non-null, non-array object values", () => {
    expect(isExternalObject({ answer: "yes" })).toBe(true);
    for (const value of [null, [], "object", 1, true]) {
      expect(isExternalObject(value)).toBe(false);
    }
  });

  test("narrows only nonnegative safe integer token counts", () => {
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) {
      expect(isTokenCount(value)).toBe(true);
    }
    for (const value of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, "1", null]) {
      expect(isTokenCount(value)).toBe(false);
    }
  });

  test("bridges a canonical schema without replacing its identity", () => {
    const schema = Type.Object({ answer: Type.String() }, { additionalProperties: false });
    expect(Object.is(sdkSchemaRecord(schema), schema)).toBe(true);
  });
});

describe("shared provider transport", () => {
  test("captures adapter configuration before later caller mutation", async () => {
    const config = { apiKey: "captured" };
    const client = createTransportClient(config, async (captured) => {
      expect(captured.apiKey).toBe("captured");
      const error = createTransportError("missing_credentials", "test failure");
      return createPreAttemptModelFailure(error);
    });
    config.apiKey = "changed";

    const outcome = await client.invoke(modelRequest(), new AbortController().signal);

    expect(outcome.status).toBe("failure");
  });

  test("records one successful attempt and exact semantic evidence", async () => {
    const outcome = await run(async () => admitted());

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") throw new Error("Expected success");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.parsedJson).toEqual({ answer: "yes" });
    expect(outcome.rawResponse).toBe('{"answer":"yes"}');
    expect(outcome.usage).toEqual({
      latencyMs: 15,
      tokens: { input: 3, output: 2 },
      requestId: "request-1",
    });
    expect(outcome.attempts[0].timing.startedAt).toBe("2026-09-01T00:00:00.123000Z");
  });

  for (const raw of ["null", "[]", "true", '"text"', "{broken"]) {
    test(`rejects non-object or malformed JSON exactly: ${raw}`, async () => {
      const outcome = await run(async () => admitted(raw));

      expect(outcome.status).toBe("failure");
      if (outcome.status !== "failure") throw new Error("Expected failure");
      expect(outcome.error.kind).toBe("invalid_response");
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.rawResponse).toBe(raw);
      expect(outcome.parsedJson).toBeNull();
      expect(outcome.usage?.requestId).toBe("request-1");
    });
  }
});

describe("shared provider transport retry policy", () => {
  for (const kind of ["timeout", "rate_limited", "provider_unavailable"] as const) {
    test(`retries the retryable ${kind} kind exactly once`, async () => {
      let calls = 0;
      const outcome = await run(
        async () => {
          calls += 1;
          throw new Error(kind);
        },
        undefined,
        undefined,
        () => createTransportError(kind, kind),
      );

      expect(calls).toBe(2);
      expect(outcome.status).toBe("failure");
      expect(outcome.attempts).toHaveLength(2);
    });
  }

  for (const kind of [
    "invalid_model_name",
    "missing_credentials",
    "invalid_payload",
    "model_not_found",
    "provider_error",
    "invalid_response",
  ] as const) {
    test(`does not retry the terminal ${kind} kind`, async () => {
      let calls = 0;
      const outcome = await run(
        async () => {
          calls += 1;
          throw new Error(kind);
        },
        undefined,
        undefined,
        () => createTransportError(kind, kind),
      );

      expect(calls).toBe(1);
      expect(outcome.status).toBe("failure");
      expect(outcome.attempts).toHaveLength(1);
    });
  }
});

describe("shared provider transport interruption", () => {
  test("cancels before invocation without an interrupted attempt row", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const outcome = await run(async () => {
      calls += 1;
      return admitted();
    }, controller.signal);

    expect(calls).toBe(0);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.attempts).toHaveLength(0);
  });

  test("retains only a completed retryable row when the retry is cancelled", async () => {
    const controller = new AbortController();
    let calls = 0;
    const outcome = await run(
      async () => {
        calls += 1;
        if (calls === 1) throw new Error("retry");
        controller.abort();
        return admitted();
      },
      controller.signal,
      undefined,
      () => createTransportError("rate_limited", "retry"),
    );

    expect(calls).toBe(2);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.attempts).toHaveLength(1);
  });

  test("classifies an attempt timeout separately from caller cancellation", async () => {
    const timeoutSignal = AbortSignal.abort(new DOMException("timed out", "TimeoutError"));
    const outcome = await run(async () => admitted(), undefined, clock(timeoutSignal));

    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("timeout");
    expect(outcome.attempts).toHaveLength(2);
  });
});

describe("shared provider transport first-abort provenance", () => {
  test("retains timeout when timeout aborts before caller cancellation", async () => {
    const caller = new AbortController();
    const timeout = new AbortController();
    let calls = 0;
    const outcome = await run(
      async () => {
        calls += 1;
        timeout.abort();
        caller.abort();
        throw new Error("interrupted");
      },
      caller.signal,
      clock(timeout.signal),
    );

    expect(calls).toBe(1);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.error?.kind).toBe("timeout");
  });

  test("returns cancellation when caller aborts before timeout", async () => {
    const caller = new AbortController();
    const timeout = new AbortController();
    const outcome = await run(
      async () => {
        caller.abort();
        timeout.abort();
        throw new Error("interrupted");
      },
      caller.signal,
      clock(timeout.signal),
    );

    expect(outcome.status).toBe("cancelled");
    expect(outcome.attempts).toHaveLength(0);
  });

  test("records deadline timeout when caller abort arrives after expiry", async () => {
    const caller = new AbortController();
    const readings = [0, 0, 150, 160];
    const outcome = await run(
      async () => {
        caller.abort();
        throw new Error("late cancellation");
      },
      caller.signal,
      scriptedClock(readings),
      undefined,
      100,
    );

    expect(outcome.status).toBe("cancelled");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.error?.kind).toBe("timeout");
  });
});

describe("shared provider transport deadline timing", () => {
  test("closes attempt timing only after strict parsing", async () => {
    const readings = [0, 5, 25, 30];
    const outcome = await run(
      async () => admitted("{broken"),
      undefined,
      scriptedClock(readings),
      undefined,
      50,
    );

    expect(outcome.status).toBe("failure");
    expect(outcome.attempts[0]?.timing.durationMs).toBe(20);
    expect(outcome.rawResponse).toBe("{broken");
  });

  test("enforces elapsed deadline when timer delivery is delayed", async () => {
    const readings = [0, 0, 101, 101, 202];
    const outcome = await run(
      async () => admitted(),
      undefined,
      scriptedClock(readings),
      undefined,
      100,
    );

    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("timeout");
    expect(outcome.attempts.map((attempt) => attempt.timing.durationMs)).toEqual([101, 101]);
    expect(outcome.attempts.map((attempt) => attempt.error?.kind)).toEqual(["timeout", "timeout"]);
    expect(outcome.rawResponse).toBe('{"answer":"yes"}');
    expect(outcome.parsedJson).toEqual({ answer: "yes" });
    expect(outcome.usage).toEqual({
      latencyMs: 202,
      tokens: { input: 3, output: 2 },
      requestId: "request-1",
    });
    expect(outcome.identity).toEqual(IDENTITY);
  });
});
