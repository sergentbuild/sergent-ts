import { captureError } from "sergent-ts-core";
import type { JsonObject, JsonValue } from "sergent-ts-core";

import type { CapturedValue } from "../records/index.js";

/** Maximum retained degraded rendering length in Unicode code points. */
const MAX_CAPTURE_TEXT = 2048;

/** Values whose native data must not enter generic captured projections. */
function isUnsupportedObject(value: object): boolean {
  return (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Promise ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

/** Bounds diagnostic text without splitting a Unicode code point. */
function boundCaptureText(value: string): string {
  return Array.from(value).slice(0, MAX_CAPTURE_TEXT).join("");
}

/** Returns the stable primitive or implementation-native concrete type name. */
export function capturedTypeName(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return typeof value;
  const constructor = Reflect.get(value, "constructor");
  if (typeof constructor === "function" && constructor.name.length > 0) {
    return constructor.name;
  }
  return "Object";
}

/** Produces a bounded implementation-native rendering for an unsupported leaf. */
function nativeRendering(value: unknown): string {
  return boundCaptureText(String(value));
}

/** Projects one unsupported leaf into bounded diagnostic JSON. */
function degradedValue(value: unknown): JsonObject {
  return {
    type: capturedTypeName(value),
    repr: nativeRendering(value),
  };
}

/** Projects one array while detecting only cycles on the active traversal path. */
function projectArray(value: readonly unknown[], ancestors: WeakSet<object>): readonly JsonValue[] {
  if (ancestors.has(value)) throw new TypeError("Captured value contains a cycle");
  ancestors.add(value);
  try {
    return value.map((entry) => projectValue(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

/** Projects enumerable fields from one ordinary object. */
function projectObject(value: object, ancestors: WeakSet<object>): JsonObject {
  if (ancestors.has(value)) throw new TypeError("Captured value contains a cycle");
  ancestors.add(value);
  try {
    const projected: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(projected, key, {
        value: projectValue(Reflect.get(value, key), ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return projected;
  } finally {
    ancestors.delete(value);
  }
}

/** Converts one reached value to its exact best-effort JSON projection. */
export function projectValue(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet(),
): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : degradedValue(value);
  if (Array.isArray(value)) return projectArray(value, ancestors);
  if (typeof value === "object") {
    return isUnsupportedObject(value) ? degradedValue(value) : projectObject(value, ancestors);
  }
  return degradedValue(value);
}

/** Renders an arbitrary thrown value without letting rendering replace capture evidence. */
function thrownMessage(reason: unknown): string {
  try {
    return reason instanceof Error ? reason.message : String(reason);
  } catch {
    return "unrenderable projection failure";
  }
}

/** Captures one value without allowing projection failure to affect the run. */
export function captureValue(value: unknown): CapturedValue {
  let valueType = "unknown";
  try {
    valueType = capturedTypeName(value);
    return {
      value: projectValue(value),
      value_type: valueType,
      error: null,
      status: "captured" as const,
    };
  } catch (reason) {
    const message = boundCaptureText(`Failed to capture value: ${thrownMessage(reason)}`);
    return {
      value: null,
      value_type: valueType,
      error: captureError(message, valueType),
      status: "capture_error" as const,
    };
  }
}
