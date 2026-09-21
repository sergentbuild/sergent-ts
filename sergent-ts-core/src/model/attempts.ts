import { isConstructedTransportError, isNonRetryableError, isRetryableError } from "./transport.js";
import type {
  NonRetryableTransportFailureKind,
  RetryableTransportFailureKind,
  TransportError,
} from "./transport.js";

/** Private construction proof for completed model attempts. */
const modelAttemptBrand: unique symbol = Symbol("ModelAttempt");

/** Closed timing for one completed native provider attempt. */
export interface ModelAttemptTiming {
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly durationMs: number;
}

/** One provider attempt completed only after strict response admission. */
export interface SuccessfulModelAttempt {
  readonly status: "success";
  readonly timing: ModelAttemptTiming;
  readonly retryable: null;
  readonly error: null;
  readonly [modelAttemptBrand]: true;
}

/** One completed failure that permits the single framework retry. */
export interface RetryableFailedModelAttempt {
  readonly status: "failure";
  readonly timing: ModelAttemptTiming;
  readonly retryable: true;
  readonly error: TransportError<RetryableTransportFailureKind>;
  readonly [modelAttemptBrand]: true;
}

/** One completed failure that closes provider attempt sequencing. */
export interface NonRetryableFailedModelAttempt {
  readonly status: "failure";
  readonly timing: ModelAttemptTiming;
  readonly retryable: false;
  readonly error: TransportError<NonRetryableTransportFailureKind>;
  readonly [modelAttemptBrand]: true;
}

/** One completed provider attempt that retained its expected failure. */
export type FailedModelAttempt = RetryableFailedModelAttempt | NonRetryableFailedModelAttempt;

/** One completed provider invocation attempt. */
export type ModelAttempt = SuccessfulModelAttempt | FailedModelAttempt;

/** A successful first attempt or one retry following a retryable failure. */
export type SuccessfulModelAttempts =
  | readonly [SuccessfulModelAttempt]
  | readonly [RetryableFailedModelAttempt, SuccessfulModelAttempt];

/** One terminal failure or one retry following a retryable failure. */
export type FailedModelAttempts =
  | readonly [FailedModelAttempt]
  | readonly [RetryableFailedModelAttempt, FailedModelAttempt];

/** Evidence retained before caller cancellation interrupts an active attempt. */
export type CancelledModelAttempts = readonly [] | readonly [RetryableFailedModelAttempt];

/** Rejects arrays containing data not built by the attempt factories. */
export function assertConstructedModelAttempts(
  attempts: readonly unknown[],
): asserts attempts is readonly ModelAttempt[] {
  const constructed = attempts.every(
    (attempt) =>
      typeof attempt === "object" &&
      attempt !== null &&
      Object.hasOwn(attempt, modelAttemptBrand) &&
      Reflect.get(attempt, modelAttemptBrand) === true,
  );
  if (!constructed) throw new TypeError("Model attempts must be factory-constructed");
}

/** Constructs the only successful completed-attempt shape. */
export function createSuccessfulModelAttempt(timing: ModelAttemptTiming): SuccessfulModelAttempt {
  return {
    status: "success" as const,
    timing,
    retryable: null,
    error: null,
    [modelAttemptBrand]: true as const,
  };
}

/** Constructs a failed attempt with retryability fixed by its error kind. */
export function createFailedModelAttempt(
  timing: ModelAttemptTiming,
  error: TransportError<RetryableTransportFailureKind>,
): RetryableFailedModelAttempt;
export function createFailedModelAttempt(
  timing: ModelAttemptTiming,
  error: TransportError<NonRetryableTransportFailureKind>,
): NonRetryableFailedModelAttempt;
export function createFailedModelAttempt(
  timing: ModelAttemptTiming,
  error: TransportError,
): FailedModelAttempt;
export function createFailedModelAttempt(
  timing: ModelAttemptTiming,
  error: TransportError,
): FailedModelAttempt {
  if (!isConstructedTransportError(error)) {
    throw new TypeError("Model attempt errors must be factory-constructed");
  }
  if (isRetryableError(error)) {
    return {
      status: "failure" as const,
      timing,
      retryable: true as const,
      error,
      [modelAttemptBrand]: true as const,
    };
  }
  if (isNonRetryableError(error)) {
    return {
      status: "failure" as const,
      timing,
      retryable: false as const,
      error,
      [modelAttemptBrand]: true as const,
    };
  }
  throw new TypeError("Transport error kind has no retry policy");
}
