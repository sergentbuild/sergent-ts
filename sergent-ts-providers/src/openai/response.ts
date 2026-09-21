import { createTransportError } from "sergent-ts-core";
import { isExternalObject, isTokenCount, reportedTokenCounts } from "../transport/index.js";
import type {
  ExternalObject,
  NativeAdmission,
  NativeResponseEvidence,
} from "../transport/index.js";

/** Preserves each complete OpenAI token direction independently. */
function tokens(response: ExternalObject): NativeResponseEvidence["tokens"] {
  const usage = response.usage;
  if (!isExternalObject(usage)) return null;
  const input = isTokenCount(usage.input_tokens) ? usage.input_tokens : null;
  const output = isTokenCount(usage.output_tokens) ? usage.output_tokens : null;
  return reportedTokenCounts(input, output);
}

/** Returns refusal presence, or null when message content is malformed. */
function messageRefusal(content: unknown): boolean | null {
  if (!Array.isArray(content)) return null;
  let refused = false;
  for (const item of content) {
    if (!isExternalObject(item) || typeof item.type !== "string") return null;
    if (item.type === "refusal") refused = true;
  }
  return refused;
}

/** Returns refusal presence, or null when the output envelope is malformed. */
function refusalState(output: unknown): boolean | null {
  if (!Array.isArray(output)) return null;
  let refused = false;
  for (const item of output) {
    if (!isExternalObject(item) || typeof item.type !== "string") return null;
    if (item.type !== "message") continue;
    const messageState = messageRefusal(item.content);
    if (messageState === null) return null;
    if (messageState) refused = true;
  }
  return refused;
}

/** Captures only safely narrowed response facts from a reached envelope. */
function evidence(response: ExternalObject): NativeResponseEvidence | null {
  if (typeof response.output_text !== "string") return null;
  const requestId = Reflect.get(response, "_request_id");
  return {
    rawResponse: response.output_text,
    tokens: tokens(response),
    requestId: typeof requestId === "string" ? requestId : null,
  };
}

/** Constructs one nonretryable invalid OpenAI envelope result. */
function rejected(response: NativeResponseEvidence | null): NativeAdmission {
  return {
    status: "rejected",
    error: createTransportError("invalid_response", "OpenAI response did not complete naturally"),
    response,
  };
}

/** Admits only a fully narrowed natural OpenAI envelope without refusal. */
export function admitOpenAIResponse(value: unknown): NativeAdmission {
  if (!isExternalObject(value)) return rejected(null);
  const reached = evidence(value);
  const refused = refusalState(value.output);
  const invalid =
    value.status !== "completed" ||
    value.error !== null ||
    value.incomplete_details !== null ||
    refused !== false ||
    reached === null;
  return invalid ? rejected(reached) : { status: "admitted", response: reached };
}
