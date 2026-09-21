import type {
  ExecutionPlan,
  JsonObject,
  ModelMessage,
  ModelRequest,
  Patch,
  PngImage,
} from "sergent-ts-core";

import type { CapturedValue, PatchSummary } from "../records/index.js";
import { captureValue, projectValue } from "./projection.js";

/** Narrows a projected JSON value to a non-array object. */
function isJsonObject(value: import("sergent-ts-core").JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Projects an image without retaining its base64 payload. */
function projectPngImage(image: PngImage): JsonObject {
  return {
    media_type: image.media_type,
    bytes: atob(image.data).length,
  };
}

/** Projects one portable message with conditional image metadata. */
export function projectModelMessage(message: ModelMessage): JsonObject {
  if (message.role === "system" || message.images === undefined) {
    return { role: message.role, content: message.content };
  }
  return {
    role: message.role,
    content: message.content,
    images: message.images.map(projectPngImage),
  };
}

/** Projects a model request without duplicating its separately retained schema. */
function projectModelRequest(request: ModelRequest): JsonObject {
  return {
    model_name: request.modelName,
    messages: request.messages.map(projectModelMessage),
    model_settings: {
      maxOutputTokens: request.modelSettings.maxOutputTokens,
      timeoutMs: request.modelSettings.timeoutMs,
      thinkingEffort: request.modelSettings.thinkingEffort,
    },
  };
}

/** Captures the exact model request projection retained at call start. */
export function captureModelRequest(request: ModelRequest): CapturedValue {
  return captureValue(projectModelRequest(request));
}

/** Builds the exact ExecutionPlan evidence without serializing operation IDs. */
export function executionPlanEvidence(plan: ExecutionPlan): object {
  return {
    base: plan.base,
    steps: plan.steps.map((step) => step.operation),
  };
}

/** Builds the exact aligned Patch summary retained by Run Records and conflict errors. */
export function createPatchSummary(patch: Patch): PatchSummary {
  const operationIds = patch.steps.map((step) => step.op_id);
  return {
    base: { ...patch.base },
    operation_count: patch.steps.length,
    operation_ids: operationIds,
    operation_call_names: patch.steps.map((step) => step.operation.call),
    operation_trace_ids: [...operationIds],
    operations: patch.steps.map((step) => captureValue(step.operation)),
  };
}

/** Projects the exact Patch summary for structured RunError metadata. */
export function projectPatchSummary(patch: Patch): JsonObject {
  return projectSchemaObject(createPatchSummary(patch));
}

/** Projects a canonical schema object while ignoring implementation-only symbols. */
export function projectSchemaObject(value: object): JsonObject {
  const projected = projectValue(value);
  if (!isJsonObject(projected)) {
    throw new TypeError("Canonical schema projection must remain an object");
  }
  return projected;
}
