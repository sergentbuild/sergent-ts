import { Buffer } from "node:buffer";

import type { JsonObject, JsonValue } from "sergent-ts-core";

import { capturedTypeName } from "sergent-ts-observability";

/** Maximum retained direct-event diagnostic rendering length. */
const MAX_DIRECT_TEXT = 2048;

/** Bounds one diagnostic field without splitting a Unicode code point. */
function boundText(value: string): string {
  return Array.from(value).slice(0, MAX_DIRECT_TEXT).join("");
}

/** Renders one unsupported direct-event leaf. */
function degraded(value: unknown): JsonObject {
  return {
    type: capturedTypeName(value),
    repr: boundText(String(value)),
  };
}

/** Converts one ArrayBuffer view to a base64 string. */
function binaryView(value: ArrayBufferView): string {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64");
}

/** Identifies collection objects that degrade instead of becoming false structures. */
function isUnsupportedCollection(value: object): boolean {
  return (
    value instanceof Map ||
    value instanceof Set ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof Promise ||
    value instanceof RegExp
  );
}

/** Converts one ordinary object while rejecting cycles before writer access. */
function directObject(value: object, ancestors: WeakSet<object>): JsonObject {
  if (ancestors.has(value)) throw new TypeError("Direct event payload contains a cycle");
  ancestors.add(value);
  try {
    const projected: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      Object.defineProperty(projected, key, {
        value: directValue(Reflect.get(value, key), ancestors),
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

/** Converts one array while rejecting cycles before writer access. */
function directArray(value: readonly unknown[], ancestors: WeakSet<object>): readonly JsonValue[] {
  if (ancestors.has(value)) throw new TypeError("Direct event payload contains a cycle");
  ancestors.add(value);
  try {
    return value.map((entry) => directValue(entry, ancestors));
  } finally {
    ancestors.delete(value);
  }
}

/** Converts one object-shaped direct value by its owned native representation. */
function directObjectValue(value: object, ancestors: WeakSet<object>): JsonValue {
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) return value.toString();
  if (value instanceof Error) {
    return {
      type: capturedTypeName(value),
      message: boundText(value.message),
    };
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString("base64");
  if (ArrayBuffer.isView(value)) return binaryView(value);
  if (Array.isArray(value)) return directArray(value, ancestors);
  if (isUnsupportedCollection(value)) return degraded(value);
  return directObject(value, ancestors);
}

/** Converts direct application data to the portable outbound JSON vocabulary. */
export function directValue(value: unknown, ancestors: WeakSet<object> = new WeakSet()): JsonValue {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Direct event numbers must be finite");
      return value;
    case "object":
      return value === null ? null : directObjectValue(value, ancestors);
    default:
      return degraded(value);
  }
}
