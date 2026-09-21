import { createTransportError } from "sergent-ts-core";
import type { JsonObject, TransportError } from "sergent-ts-core";

/** Successful strict parsing of one non-null, non-array JSON object. */
interface ObjectParseSuccess {
  readonly ok: true;
  readonly value: JsonObject;
}

/** Failed strict parsing of one semantic provider response. */
interface ObjectParseFailure {
  readonly ok: false;
  readonly error: TransportError<"invalid_response">;
}

/** Result of the provider transport's single strict parse. */
export type ObjectParseResult = ObjectParseSuccess | ObjectParseFailure;

/** Narrows a JSON-parsed top-level value to the required object shape. */
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses exact response text once and admits only one JSON object. */
export function parseJsonObject(text: string): ObjectParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: createTransportError("invalid_response", "Provider returned malformed JSON"),
    };
  }
  if (!isJsonObject(value)) {
    return {
      ok: false,
      error: createTransportError("invalid_response", "Provider response was not one JSON object"),
    };
  }
  return { ok: true, value };
}
