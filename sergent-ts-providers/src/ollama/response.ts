import { createTransportError } from "sergent-ts-core";
import { isExternalObject, isTokenCount, reportedTokenCounts } from "../transport/index.js";
import type {
  ExternalObject,
  NativeAdmission,
  NativeResponseEvidence,
} from "../transport/index.js";

/** Preserves each complete Ollama token direction independently. */
function tokens(response: ExternalObject): NativeResponseEvidence["tokens"] {
  const input = isTokenCount(response.prompt_eval_count) ? response.prompt_eval_count : null;
  const output = isTokenCount(response.eval_count) ? response.eval_count : null;
  return reportedTokenCounts(input, output);
}

/** Captures only safely narrowed response facts from a reached message. */
function evidence(response: ExternalObject): NativeResponseEvidence | null {
  const message = response.message;
  if (!isExternalObject(message) || typeof message.content !== "string") return null;
  return {
    rawResponse: message.content,
    tokens: tokens(response),
    requestId: null,
  };
}

/** Constructs one nonretryable invalid Ollama envelope result. */
function rejected(response: NativeResponseEvidence | null): NativeAdmission {
  return {
    status: "rejected",
    error: createTransportError("invalid_response", "Ollama response did not complete naturally"),
    response,
  };
}

/** Admits only a fully narrowed Ollama response with natural stop termination. */
export function admitOllamaResponse(value: unknown): NativeAdmission {
  if (!isExternalObject(value)) return rejected(null);
  const reached = evidence(value);
  const invalid = value.done !== true || value.done_reason !== "stop" || reached === null;
  return invalid ? rejected(reached) : { status: "admitted", response: reached };
}
