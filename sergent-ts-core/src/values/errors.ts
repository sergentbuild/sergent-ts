import type { JsonObject } from "./json.js";

/** Maximum retained RunError message length in Unicode code points. */
const MAX_ERROR_MESSAGE_LENGTH = 2048;

/** An isolated structured error used for expected run failures. */
export interface RunError<Kind extends string = string> {
  readonly kind: Kind;
  readonly message: string;
  readonly metadata: JsonObject;
}

/** An application validation rejection before framework correlation is added. */
export interface ValidationIssue {
  readonly kind: string;
  readonly message: string;
  readonly metadata: JsonObject;
}

/** Truncates human error prose without splitting a Unicode code point. */
function boundMessage(message: string): string {
  return Array.from(message).slice(0, MAX_ERROR_MESSAGE_LENGTH).join("");
}

/** Constructs an isolated immutable expected run failure. */
export function runError<const Kind extends string>(
  kind: Kind,
  message: string,
  metadata: JsonObject = {},
): RunError<Kind> {
  return {
    kind,
    message: boundMessage(message),
    metadata: structuredClone(metadata),
  };
}

/** Constructs an isolated application validation issue. */
export function validationIssue(
  kind: string,
  message: string,
  metadata: JsonObject = {},
): ValidationIssue {
  return { kind, message, metadata: structuredClone(metadata) };
}

/** Constructs a captured-value projection failure. */
export function captureError(message: string, valueType: string): RunError<"capture_error"> {
  return runError("capture_error", message, { value_type: valueType });
}

/** Constructs a contained observer callback failure. */
export function observerError(message: string, metadata: JsonObject): RunError<"observer_error"> {
  return runError("observer_error", message, metadata);
}

/** Constructs the framework cancellation outcome. */
export function cancelledError(message: string): RunError<"cancelled"> {
  return runError("cancelled", message);
}

/** Constructs a deterministic validation rejection. */
export function validationError(
  message: string,
  metadata: JsonObject,
): RunError<"validation_error"> {
  return runError("validation_error", message, metadata);
}

/** Constructs a typed proposal crossing failure. */
export function schemaValidationError(
  message: string,
  metadata: JsonObject = {},
): RunError<"schema_validation_failed"> {
  return runError("schema_validation_failed", message, metadata);
}

/** Constructs a failed deterministic Patch rebase. */
export function mergeConflictError(
  message: string,
  metadata: JsonObject,
): RunError<"merge_conflict"> {
  return runError("merge_conflict", message, metadata);
}

/** Constructs a shared-state stale Patch rejection. */
export function stalePatchError(
  message: string,
  baseRevision: number,
  currentRevision: number,
): RunError<"stale_patch"> {
  return runError("stale_patch", message, {
    base_revision: baseRevision,
    current_revision: currentRevision,
  });
}

/** Constructs a Patch envelope or identity rejection. */
export function patchValidationError(
  message: string,
  metadata: JsonObject = {},
): RunError<"patch_validation"> {
  return runError("patch_validation", message, metadata);
}

/** Constructs a contained unexpected ordinary exception. */
export function internalError(message: string, metadata: JsonObject): RunError<"internal_error"> {
  return runError("internal_error", message, metadata);
}
