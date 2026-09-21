import {
  cancelledError,
  createFailedModelAttempt,
  createModelCancellation,
  createModelFailure,
  createModelSuccess,
  createSuccessfulModelAttempt,
  createTransportError,
} from "sergent-ts-core";
import type {
  ModelAttempt,
  ModelAttemptTiming,
  ModelClient,
  ModelOutcome,
  ModelRequest,
  ModelUsage,
  TransportError,
} from "sergent-ts-core";
import { parseJsonObject } from "./parse.js";
import type {
  NativeAdmission,
  NativeResponseEvidence,
  ParsedNativeResponse,
  TransportCall,
  TransportClock,
  TransportExecution,
} from "./types.js";

/** Default wall, monotonic, and timeout services for production invocations. */
const SYSTEM_CLOCK: TransportClock = {
  wallNow: (): Date => new Date(),
  monotonicNow: (): number => performance.now(),
  timeoutSignal: (timeoutMs: number): AbortSignal => AbortSignal.timeout(timeoutMs),
};

/** One completed attempt or caller interruption returned to the in-call retry owner. */
type AttemptResult =
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "success"; attempt: ModelAttempt; response: ParsedNativeResponse }>
  | Readonly<{
      kind: "failure";
      attempt: ModelAttempt;
      response: CompletedResponseEvidence | null;
    }>;

/** Reached response facts after admission processing, including parse outcome. */
type CompletedResponseEvidence = NativeResponseEvidence &
  Readonly<{ parsedJson: ParsedNativeResponse["parsedJson"] | null }>;

/** Strict parsing result before attempt timing and deadline arbitration close. */
type ProcessedAdmission =
  | Readonly<{ kind: "success"; response: ParsedNativeResponse }>
  | Readonly<{
      kind: "failure";
      error: TransportError<"invalid_response">;
      response: CompletedResponseEvidence | null;
    }>;

/** Closed attempt timing plus the unrounded elapsed reading used for deadlines. */
interface ClosedTiming {
  readonly elapsedMs: number;
  readonly timing: ModelAttemptTiming;
}

/** First abort provenance and composed signal for one provider attempt. */
interface AttemptControl {
  readonly signal: AbortSignal;
  winner(): "caller" | "timeout" | null;
  expire(): void;
  close(): void;
}

/** Formats one JavaScript timestamp with the framework's six fractional digits. */
function timestamp(value: Date): string {
  return value.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

/** Closes timing after response admission and strict parsing have finished. */
function closeTiming(
  clock: TransportClock,
  startedAt: string,
  startedMonotonic: number,
): ClosedTiming {
  const finishedAt = timestamp(clock.wallNow());
  const elapsedMs = Math.max(0, clock.monotonicNow() - startedMonotonic);
  return {
    elapsedMs,
    timing: {
      startedAt,
      finishedAt,
      durationMs: Math.trunc(elapsedMs),
    },
  };
}

/** Creates first-winner abort provenance and one SDK-facing composed signal. */
function attemptControl(
  callerSignal: AbortSignal,
  timeoutSignal: AbortSignal,
  clock: TransportClock,
  startedMonotonic: number,
  timeoutMs: number,
): AttemptControl {
  const controller = new AbortController();
  let winner: "caller" | "timeout" | null = null;
  const win = (source: "caller" | "timeout", reason: unknown): void => {
    if (winner !== null) return;
    winner = source;
    controller.abort(reason);
  };
  const callerAbort = (): void => {
    const elapsedMs = Math.max(0, clock.monotonicNow() - startedMonotonic);
    const source = elapsedMs >= timeoutMs ? "timeout" : "caller";
    const reason =
      source === "timeout"
        ? new DOMException("Attempt deadline elapsed", "TimeoutError")
        : callerSignal.reason;
    win(source, reason);
  };
  const timeoutAbort = (): void => win("timeout", timeoutSignal.reason);
  callerSignal.addEventListener("abort", callerAbort, { once: true });
  timeoutSignal.addEventListener("abort", timeoutAbort, { once: true });
  if (callerSignal.aborted) callerAbort();
  if (timeoutSignal.aborted) timeoutAbort();
  return {
    signal: controller.signal,
    winner: () => winner,
    expire: () => win("timeout", new DOMException("Attempt deadline elapsed", "TimeoutError")),
    close: () => {
      callerSignal.removeEventListener("abort", callerAbort);
      timeoutSignal.removeEventListener("abort", timeoutAbort);
    },
  };
}

/** Creates whole-call usage from reached provider response evidence. */
function modelUsage(call: TransportCall, response: NativeResponseEvidence): ModelUsage {
  return {
    latencyMs: Math.max(0, Math.trunc(call.clock.monotonicNow() - call.startedMonotonic)),
    tokens: response.tokens,
    requestId: response.requestId,
  };
}

/** Strictly parses an admitted semantic response before timing is closed. */
function processAdmission(admission: NativeAdmission): ProcessedAdmission {
  if (admission.status === "rejected") {
    const response =
      admission.response === null ? null : { ...admission.response, parsedJson: null };
    return { kind: "failure", error: admission.error, response };
  }
  const parsed = parseJsonObject(admission.response.rawResponse);
  if (!parsed.ok) {
    return {
      kind: "failure",
      error: parsed.error,
      response: { ...admission.response, parsedJson: null },
    };
  }
  return {
    kind: "success",
    response: { ...admission.response, parsedJson: parsed.value },
  };
}

/** Resolves first-abort provenance and the monotonic deadline after processing. */
function abortWinner(
  control: AttemptControl,
  closed: ClosedTiming,
  timeoutMs: number,
): "caller" | "timeout" | null {
  if (control.winner() === null && closed.elapsedMs >= timeoutMs) control.expire();
  return control.winner();
}

/** Converts processed response data into one completed, timed attempt. */
function completedResult(processed: ProcessedAdmission, timing: ModelAttemptTiming): AttemptResult {
  if (processed.kind === "failure") {
    return {
      kind: "failure",
      attempt: createFailedModelAttempt(timing, processed.error),
      response: processed.response,
    };
  }
  return {
    kind: "success",
    attempt: createSuccessfulModelAttempt(timing),
    response: processed.response,
  };
}

/** Returns cancellation, timeout, or a classified response-less SDK failure. */
function failedInvocation(
  execution: TransportExecution,
  control: AttemptControl,
  closed: ClosedTiming,
  error: unknown,
): AttemptResult {
  const winner = abortWinner(control, closed, execution.timeoutMs);
  if (winner === "caller") return { kind: "cancelled" };
  const failure =
    winner === "timeout"
      ? createTransportError("timeout", "Provider attempt timed out")
      : execution.classify(error);
  return {
    kind: "failure",
    attempt: createFailedModelAttempt(closed.timing, failure),
    response: null,
  };
}

/** Runs one bounded native attempt with first-winner abort provenance. */
async function runAttempt(execution: TransportExecution): Promise<AttemptResult> {
  if (execution.callerSignal.aborted) return { kind: "cancelled" };
  const clock = execution.call.clock;
  const startedAt = timestamp(clock.wallNow());
  const startedMonotonic = clock.monotonicNow();
  const timeoutSignal = clock.timeoutSignal(execution.timeoutMs);
  const control = attemptControl(
    execution.callerSignal,
    timeoutSignal,
    clock,
    startedMonotonic,
    execution.timeoutMs,
  );
  try {
    const admission = await execution.invoke(control.signal);
    const processed = processAdmission(admission);
    const closed = closeTiming(clock, startedAt, startedMonotonic);
    const winner = abortWinner(control, closed, execution.timeoutMs);
    if (winner === "caller") return { kind: "cancelled" };
    if (winner === "timeout") {
      const error = createTransportError("timeout", "Provider attempt timed out");
      return {
        kind: "failure",
        attempt: createFailedModelAttempt(closed.timing, error),
        response: processed.response,
      };
    }
    return completedResult(processed, closed.timing);
  } catch (error) {
    const closed = closeTiming(clock, startedAt, startedMonotonic);
    return failedInvocation(execution, control, closed, error);
  } finally {
    control.close();
  }
}

/** Captures whole-call timing before selection, discovery, and request construction. */
export function startTransportCall(clock: TransportClock = SYSTEM_CLOCK): TransportCall {
  return { clock, startedMonotonic: clock.monotonicNow() };
}

/** Captures adapter configuration and starts timing before provider preflight. */
export function createTransportClient<Config extends object>(
  config: Config,
  invoke: (
    captured: Readonly<Config>,
    request: ModelRequest,
    callerSignal: AbortSignal,
    call: TransportCall,
  ) => Promise<ModelOutcome>,
): ModelClient {
  const captured: Readonly<Config> = { ...config };
  return {
    invoke: (request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> =>
      invoke(captured, request, signal, startTransportCall()),
  };
}

/** Executes at most two immediate in-call attempts and constructs one truthful outcome. */
export async function executeTransport(execution: TransportExecution): Promise<ModelOutcome> {
  const attempts: ModelAttempt[] = [];
  for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
    const result = await runAttempt(execution);
    if (result.kind === "cancelled") {
      return createModelCancellation(
        cancelledError("Model invocation cancelled by caller"),
        execution.identity,
        attempts,
      );
    }
    attempts.push(result.attempt);
    if (result.kind === "success") {
      const usage = modelUsage(execution.call, result.response);
      return createModelSuccess(
        execution.identity,
        attempts,
        result.response.rawResponse,
        result.response.parsedJson,
        usage,
      );
    }
    if (!result.attempt.retryable || attemptNumber === 1) {
      const response = result.response;
      const evidence =
        response === null
          ? null
          : {
              rawResponse: response.rawResponse,
              parsedJson: response.parsedJson,
              usage: modelUsage(execution.call, response),
            };
      return createModelFailure(execution.identity, attempts, evidence);
    }
  }
  throw new Error("Provider retry sequence exited without an outcome");
}
