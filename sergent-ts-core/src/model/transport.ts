import type { JsonObject, RunError } from "../values/index.js";
import { runError } from "../values/index.js";

/** Private construction proof for closed transport errors. */
const transportErrorBrand: unique symbol = Symbol("TransportError");

/** Transport failures that may trigger the one permitted immediate retry. */
export type RetryableTransportFailureKind = "timeout" | "rate_limited" | "provider_unavailable";

/** Transport failures that must never trigger another provider attempt. */
export type NonRetryableTransportFailureKind =
  | "invalid_model_name"
  | "missing_credentials"
  | "invalid_payload"
  | "model_not_found"
  | "provider_error"
  | "invalid_response";

/** Failures that may occur before any native provider attempt begins. */
export type PreAttemptTransportFailureKind =
  | "invalid_model_name"
  | "missing_credentials"
  | "invalid_payload";

/** The closed baseline provider transport failure vocabulary. */
export type TransportFailureKind = RetryableTransportFailureKind | NonRetryableTransportFailureKind;

/** Rejects transport error kinds outside the closed provider vocabulary. */
function assertTransportFailureKind(kind: string): asserts kind is TransportFailureKind {
  switch (kind) {
    case "invalid_model_name":
    case "missing_credentials":
    case "invalid_payload":
    case "model_not_found":
    case "timeout":
    case "rate_limited":
    case "provider_unavailable":
    case "provider_error":
    case "invalid_response":
      return;
    default:
      throw new TypeError("Unknown model transport failure kind");
  }
}

/** A constructed RunError whose kind belongs to the transport vocabulary. */
export interface TransportError<Kind extends TransportFailureKind = TransportFailureKind>
  extends RunError<Kind> {
  readonly [transportErrorBrand]: true;
}

/** Returns true only for factory-constructed transport errors. */
export function isConstructedTransportError(value: unknown): value is TransportError {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, transportErrorBrand) &&
    Reflect.get(value, transportErrorBrand) === true
  );
}

/** Returns true only for the three retryable transport kinds. */
function isRetryableKind(kind: TransportFailureKind): kind is RetryableTransportFailureKind {
  return kind === "timeout" || kind === "rate_limited" || kind === "provider_unavailable";
}

/** Narrows one constructed transport error by its exact retry policy. */
export function isRetryableError(
  error: TransportError,
): error is TransportError<RetryableTransportFailureKind> {
  return isRetryableKind(error.kind);
}

/** Narrows one constructed transport error to a terminal failure kind. */
export function isNonRetryableError(
  error: TransportError,
): error is TransportError<NonRetryableTransportFailureKind> {
  return !isRetryableKind(error.kind);
}

/** Returns true only for failures allowed before a provider attempt. */
export function isPreAttemptError(
  error: TransportError,
): error is TransportError<PreAttemptTransportFailureKind> {
  return (
    error.kind === "invalid_model_name" ||
    error.kind === "missing_credentials" ||
    error.kind === "invalid_payload"
  );
}

/** Constructs one isolated closed transport error. */
export function createTransportError<const Kind extends TransportFailureKind>(
  kind: Kind,
  message: string,
  metadata: JsonObject = {},
): TransportError<Kind> {
  assertTransportFailureKind(kind);
  return {
    ...runError(kind, message, {
      ...metadata,
      retryable: isRetryableKind(kind),
    }),
    [transportErrorBrand]: true as const,
  };
}
