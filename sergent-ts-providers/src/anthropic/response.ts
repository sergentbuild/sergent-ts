import { createTransportError } from "sergent-ts-core";
import { isExternalObject, isTokenCount, reportedTokenCounts } from "../transport/index.js";
import type {
  ExternalObject,
  NativeAdmission,
  NativeResponseEvidence,
} from "../transport/index.js";

/** Safely extracted semantic text from one complete content array. */
interface TextResult {
  readonly ok: boolean;
  readonly text: string;
}

/** Sums Anthropic input only when every native category is known and the sum stays safe. */
function inputTokens(usage: ExternalObject): number | null {
  const ordinary = usage.input_tokens;
  const cacheRead = usage.cache_read_input_tokens;
  const cacheCreation = usage.cache_creation_input_tokens;
  if (!isTokenCount(ordinary) || !isTokenCount(cacheRead) || !isTokenCount(cacheCreation)) {
    return null;
  }
  const input = ordinary + cacheRead + cacheCreation;
  return Number.isSafeInteger(input) ? input : null;
}

/** Preserves complete input and output counts independently. */
function tokens(response: ExternalObject): NativeResponseEvidence["tokens"] {
  const usage = response.usage;
  if (!isExternalObject(usage)) return null;
  const output = isTokenCount(usage.output_tokens) ? usage.output_tokens : null;
  return reportedTokenCounts(inputTokens(usage), output);
}

/** Concatenates ordered text blocks only after the whole content array narrows. */
function responseText(content: unknown): TextResult {
  if (!Array.isArray(content)) return { ok: false, text: "" };
  const fragments: string[] = [];
  for (const block of content) {
    if (!isExternalObject(block) || typeof block.type !== "string") {
      return { ok: false, text: "" };
    }
    if (block.type !== "text") continue;
    if (typeof block.text !== "string") return { ok: false, text: "" };
    fragments.push(block.text);
  }
  return { ok: true, text: fragments.join("") };
}

/** Captures only safely narrowed response facts from a reached envelope. */
function evidence(response: ExternalObject, text: string): NativeResponseEvidence {
  const requestId = Reflect.get(response, "_request_id");
  return {
    rawResponse: text,
    tokens: tokens(response),
    requestId: typeof requestId === "string" ? requestId : null,
  };
}

/** Constructs one nonretryable invalid Anthropic envelope result. */
function rejected(response: NativeResponseEvidence | null): NativeAdmission {
  return {
    status: "rejected",
    error: createTransportError(
      "invalid_response",
      "Anthropic response did not complete naturally",
    ),
    response,
  };
}

/** Admits only one fully narrowed naturally completed Anthropic response. */
export function admitAnthropicResponse(value: unknown): NativeAdmission {
  if (!isExternalObject(value)) return rejected(null);
  const text = responseText(value.content);
  if (!text.ok) return rejected(null);
  const reached = evidence(value, text.text);
  const invalid =
    value.stop_reason !== "end_turn" || value.stop_details !== null || text.text.length === 0;
  return invalid ? rejected(reached) : { status: "admitted", response: reached };
}
