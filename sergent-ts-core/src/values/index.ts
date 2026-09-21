/**
 * Shared JSON values, framework identity, Intent control, and structured
 * expected failures.
 */
export {
  cancelledError,
  captureError,
  internalError,
  mergeConflictError,
  observerError,
  patchValidationError,
  runError,
  schemaValidationError,
  stalePatchError,
  validationError,
  validationIssue,
} from "./errors.js";
export type { RunError, ValidationIssue } from "./errors.js";
export type {
  OperationId,
  RunId,
  SceneId,
  SceneIdentity,
} from "./ids.js";
export { mintOperationId, mintRunId } from "./ids.js";
export type { ContinueIntent, Intent, IntentFlow, StopIntent } from "./intent.js";
export type { JsonObject, JsonPrimitive, JsonValue } from "./json.js";
