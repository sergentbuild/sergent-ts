import type { JsonObject, RunError } from "../values/index.js";
import type {
  CancelledModelAttempts,
  FailedModelAttempts,
  ModelAttempt,
  RetryableFailedModelAttempt,
  SuccessfulModelAttempt,
  SuccessfulModelAttempts,
} from "./attempts.js";
import { assertConstructedModelAttempts } from "./attempts.js";
import type { ModelRequest } from "../model-request/index.js";
import { isPreAttemptError } from "./transport.js";
import type { PreAttemptTransportFailureKind, TransportError } from "./transport.js";

/** Private construction proof for valid model outcome states. */
const modelOutcomeBrand: unique symbol = Symbol("ModelOutcome");

/** Shared immutable proof that no provider attempt completed. */
const NO_ATTEMPTS: readonly [] = [];

/** The provider endpoint resolved from one full model selection. */
export interface ModelIdentity {
  readonly provider: string;
  readonly model: string;
  readonly sdkPackage: string | null;
  readonly sdkVersion: string | null;
}

/** Reported nonnegative integer token counts; unreported directions are omitted. */
export type ModelTokens = Readonly<Record<string, number>>;

/** Reached whole-call usage and response identity facts. */
export interface ModelUsage {
  readonly latencyMs: number;
  readonly tokens: ModelTokens | null;
  readonly requestId: string | null;
}

/** A strictly parsed semantic provider response. */
export interface ModelSuccess {
  readonly status: "success";
  readonly identity: ModelIdentity;
  readonly attempts: SuccessfulModelAttempts;
  readonly rawResponse: string;
  readonly parsedJson: JsonObject;
  readonly usage: ModelUsage;
  readonly [modelOutcomeBrand]: true;
}

/** Response evidence retained by a response-backed terminal failure. */
export interface ModelFailureResponse {
  readonly rawResponse: string;
  readonly parsedJson: JsonObject | null;
  readonly usage: ModelUsage;
}

/** A failure reached before a native attempt could begin. */
interface PreAttemptModelFailure {
  readonly status: "failure";
  readonly error: TransportError<PreAttemptTransportFailureKind>;
  readonly identity: ModelIdentity | null;
  readonly attempts: readonly [];
  readonly rawResponse: null;
  readonly parsedJson: null;
  readonly usage: null;
  readonly [modelOutcomeBrand]: true;
}

/** A completed attempted failure without semantic response evidence. */
interface ResponseLessModelFailure {
  readonly status: "failure";
  readonly error: TransportError;
  readonly identity: ModelIdentity;
  readonly attempts: FailedModelAttempts;
  readonly rawResponse: null;
  readonly parsedJson: null;
  readonly usage: null;
  readonly [modelOutcomeBrand]: true;
}

/** A completed attempted failure retaining all reached response evidence. */
interface ResponseBackedModelFailure {
  readonly status: "failure";
  readonly error: TransportError;
  readonly identity: ModelIdentity;
  readonly attempts: FailedModelAttempts;
  readonly rawResponse: string;
  readonly parsedJson: JsonObject | null;
  readonly usage: ModelUsage;
  readonly [modelOutcomeBrand]: true;
}

/** An expected pre-attempt, transport, or response-admission failure. */
export type ModelFailure =
  | PreAttemptModelFailure
  | ResponseLessModelFailure
  | ResponseBackedModelFailure;

/** Caller cancellation with only evidence completed before interruption. */
export interface ModelCancellation {
  readonly status: "cancelled";
  readonly error: RunError<"cancelled">;
  readonly identity: ModelIdentity | null;
  readonly attempts: CancelledModelAttempts;
  readonly rawResponse: null;
  readonly parsedJson: null;
  readonly usage: null;
  readonly [modelOutcomeBrand]: true;
}

/** The complete expected outcome of one provider-neutral model invocation. */
export type ModelOutcome = ModelSuccess | ModelFailure | ModelCancellation;

/** Correlated evidence projection that preserves every outcome-state invariant. */
type EvidenceOf<Outcome extends ModelOutcome> = Outcome extends ModelOutcome
  ? Omit<Outcome, "status" | "error" | typeof modelOutcomeBrand>
  : never;

/** Evidence common to consumers of a resolved ModelClient invocation. */
export type ModelOutcomeEvidence = EvidenceOf<ModelOutcome>;

/** Admits exactly one success, optionally after one retryable failure. */
function successfulAttempts(attempts: readonly ModelAttempt[]): SuccessfulModelAttempts {
  assertConstructedModelAttempts(attempts);
  const first = attempts[0];
  const second = attempts[1];
  if (attempts.length === 1 && first?.status === "success") {
    const result: readonly [SuccessfulModelAttempt] = [first];
    return result;
  }
  if (
    attempts.length === 2 &&
    first?.status === "failure" &&
    first.retryable &&
    second?.status === "success"
  ) {
    const result: readonly [RetryableFailedModelAttempt, SuccessfulModelAttempt] = [first, second];
    return result;
  }
  throw new TypeError("Model success requires one attempt or one retryable failure then success");
}

/** Admits exactly one failure, optionally after one retryable failure. */
function failedAttempts(attempts: readonly ModelAttempt[]): FailedModelAttempts {
  assertConstructedModelAttempts(attempts);
  const first = attempts[0];
  const second = attempts[1];
  if (attempts.length === 1 && first?.status === "failure") {
    const result: readonly [typeof first] = [first];
    return result;
  }
  if (
    attempts.length === 2 &&
    first?.status === "failure" &&
    first.retryable &&
    second?.status === "failure"
  ) {
    const result: readonly [RetryableFailedModelAttempt, typeof second] = [first, second];
    return result;
  }
  throw new TypeError("Model failure requires one attempt or one retryable failure then failure");
}

/** Admits no prior row or one retryable row before caller cancellation. */
function cancelledAttempts(attempts: readonly ModelAttempt[]): CancelledModelAttempts {
  assertConstructedModelAttempts(attempts);
  const first = attempts[0];
  if (attempts.length === 0) return NO_ATTEMPTS;
  if (attempts.length === 1 && first?.status === "failure" && first.retryable) {
    const result: readonly [RetryableFailedModelAttempt] = [first];
    return result;
  }
  throw new TypeError("Model cancellation may retain only one retryable completed attempt");
}

/** Constructs a success with one or two valid completed attempts. */
export function createModelSuccess(
  identity: ModelIdentity,
  attempts: readonly ModelAttempt[],
  rawResponse: string,
  parsedJson: JsonObject,
  usage: ModelUsage,
): ModelSuccess {
  return {
    status: "success" as const,
    identity,
    attempts: successfulAttempts(attempts),
    rawResponse,
    parsedJson,
    usage,
    [modelOutcomeBrand]: true as const,
  };
}

/** Constructs a response-less failure reached before any native attempt. */
export function createPreAttemptModelFailure(
  error: TransportError,
  identity: ModelIdentity | null = null,
): ModelFailure {
  if (!isPreAttemptError(error)) {
    throw new TypeError("Zero-attempt model failures require a pre-attempt transport kind");
  }
  return {
    status: "failure" as const,
    error,
    identity,
    attempts: NO_ATTEMPTS,
    rawResponse: null,
    parsedJson: null,
    usage: null,
    [modelOutcomeBrand]: true as const,
  };
}

/** Constructs a terminal attempted failure with correlated response evidence. */
export function createModelFailure(
  identity: ModelIdentity,
  attempts: readonly ModelAttempt[],
  response: ModelFailureResponse | null = null,
): ModelFailure {
  const capturedAttempts = failedAttempts(attempts);
  const terminalAttempt = capturedAttempts.length === 1 ? capturedAttempts[0] : capturedAttempts[1];
  if (response === null) {
    return {
      status: "failure" as const,
      error: terminalAttempt.error,
      identity,
      attempts: capturedAttempts,
      rawResponse: null,
      parsedJson: null,
      usage: null,
      [modelOutcomeBrand]: true as const,
    };
  }
  return {
    status: "failure" as const,
    error: terminalAttempt.error,
    identity,
    attempts: capturedAttempts,
    rawResponse: response.rawResponse,
    parsedJson: response.parsedJson,
    usage: response.usage,
    [modelOutcomeBrand]: true as const,
  };
}

/** Constructs caller cancellation without an interrupted-attempt row. */
export function createModelCancellation(
  error: RunError<"cancelled">,
  identity: ModelIdentity | null,
  attempts: readonly ModelAttempt[] = [],
): ModelCancellation {
  const capturedAttempts = cancelledAttempts(attempts);
  if (capturedAttempts.length > 0 && identity === null) {
    throw new TypeError("Completed model attempts require resolved provider identity");
  }
  return {
    status: "cancelled" as const,
    error,
    identity,
    attempts: capturedAttempts,
    rawResponse: null,
    parsedJson: null,
    usage: null,
    [modelOutcomeBrand]: true as const,
  };
}

/** The sole asynchronous model transport seam consumed by runtime. */
export interface ModelClient {
  /** Invokes one immutable request and resolves every expected outcome. */
  invoke(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome>;
}
