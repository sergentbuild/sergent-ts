import { internalError, observerError } from "sergent-ts-core";
import type { JsonObject, JsonValue, RunError } from "sergent-ts-core";
import type { RunObserver, RunStage, StepName } from "sergent-ts-observability";

/** Returns a stable implementation-native type name for thrown-value evidence. */
function nativeTypeName(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object" && typeof value !== "function") return typeof value;
  try {
    const name = value.constructor?.name;
    return typeof name === "string" ? name : typeof value;
  } catch {
    return typeof value;
  }
}

/** Renders thrown data without allowing message access or coercion to escape. */
function thrownMessage(reason: unknown, fallback: string): string {
  try {
    if (reason instanceof Error) {
      const message: unknown = reason.message;
      return typeof message === "string" ? message : String(message);
    }
    return String(reason);
  } catch {
    return fallback;
  }
}

/** Reads one native Error cause without trusting custom property access. */
function errorCause(error: Error): unknown {
  try {
    return error.cause;
  } catch {
    return null;
  }
}

/** Retains at most the final twenty native stack frames and 8000 characters. */
function traceback(reason: unknown): string {
  try {
    if (!(reason instanceof Error)) return "";
    return (reason.stack ?? "").split("\n").slice(-20).join("\n").slice(-8000);
  } catch {
    return "";
  }
}

/** Follows native Error causes once while guarding cycles. */
function causeChain(reason: unknown): readonly JsonValue[] {
  const seen = new Set<Error>();
  const causes: JsonValue[] = [];
  try {
    if (!(reason instanceof Error)) return causes;
    let current: unknown = errorCause(reason);
    while (current instanceof Error && !seen.has(current)) {
      seen.add(current);
      causes.push({
        exception_type: nativeTypeName(current),
        message: thrownMessage(current, "Unrenderable thrown value"),
      });
      current = errorCause(current);
    }
  } catch {
    return causes;
  }
  return causes;
}

/** Builds one contained callback failure beside the closed Run Record. */
export function observerDeliveryError(
  callback: "progress" | "finished",
  observer: RunObserver,
  reason: unknown,
  stage: RunStage,
): RunError<"observer_error"> {
  const metadata: JsonObject = {
    callback,
    observer_type: nativeTypeName(observer),
    exception_type: nativeTypeName(reason),
    stage,
  };
  const message = thrownMessage(reason, "Observer threw an unrenderable value");
  return observerError(`Observer ${callback} failed: ${message}`, metadata);
}

/** Converts one containable post-binding exception to framework evidence. */
export function runtimeInternalError(
  reason: unknown,
  currentStep: StepName | null,
): RunError<"internal_error"> {
  const metadata: JsonObject = {
    exception_type: nativeTypeName(reason),
    traceback: traceback(reason),
    cause_chain: causeChain(reason),
    current_step: currentStep,
  };
  const message = thrownMessage(reason, "Unrenderable thrown value");
  return internalError(`Unexpected runtime failure: ${message}`, metadata);
}
