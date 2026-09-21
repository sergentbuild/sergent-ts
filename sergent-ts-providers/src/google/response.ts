import { FinishReason } from "@google/genai";
import { createTransportError } from "sergent-ts-core";
import { isExternalObject, isTokenCount, reportedTokenCounts } from "../transport/index.js";
import type {
  ExternalObject,
  NativeAdmission,
  NativeResponseEvidence,
} from "../transport/index.js";

/** Safely extracted semantic text and candidate from one response. */
interface CandidateResult {
  readonly candidate: ExternalObject | null;
  readonly text: string | null;
}

/** One structurally narrowed Gemini part and its optional semantic text. */
type PartResult = Readonly<{ ok: false }> | Readonly<{ ok: true; text: string | null }>;

/** Preserves prompt usage and derives output only from a complete consistent total. */
function tokens(response: ExternalObject): NativeResponseEvidence["tokens"] {
  const usage = response.usageMetadata;
  if (!isExternalObject(usage)) return null;
  const input = isTokenCount(usage.promptTokenCount) ? usage.promptTokenCount : null;
  const total = usage.totalTokenCount;
  const output = input !== null && isTokenCount(total) && total >= input ? total - input : null;
  return reportedTokenCounts(input, output);
}

/** Narrows one candidate part without treating non-text parts as malformed. */
function partResult(value: unknown): PartResult {
  if (!isExternalObject(value)) return { ok: false };
  if (value.thought !== undefined && typeof value.thought !== "boolean") return { ok: false };
  if (value.text !== undefined && typeof value.text !== "string") return { ok: false };
  const text = typeof value.text === "string" && value.thought !== true ? value.text : null;
  return { ok: true, text };
}

/** Concatenates non-thought text only after the complete parts array narrows. */
function partsText(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  const fragments: string[] = [];
  for (const part of parts) {
    const result = partResult(part);
    if (!result.ok) return null;
    if (result.text !== null) fragments.push(result.text);
  }
  return fragments.length === 0 ? null : fragments.join("");
}

/** Extracts exactly one structurally valid candidate and its semantic text. */
function candidateResult(candidates: unknown): CandidateResult {
  if (!Array.isArray(candidates) || candidates.length !== 1) {
    return { candidate: null, text: null };
  }
  const candidate = candidates[0];
  if (!isExternalObject(candidate) || !isExternalObject(candidate.content)) {
    return { candidate: null, text: null };
  }
  return { candidate, text: partsText(candidate.content.parts) };
}

/** Returns true only when prompt feedback explicitly reports a block. */
function isBlocked(promptFeedback: unknown): boolean | null {
  if (promptFeedback === undefined) return false;
  if (!isExternalObject(promptFeedback)) return null;
  const reason = promptFeedback.blockReason;
  if (reason === undefined) return false;
  return typeof reason === "string" ? true : null;
}

/** Captures only safely narrowed response facts from a reached candidate. */
function evidence(response: ExternalObject, rawResponse: string): NativeResponseEvidence {
  const requestId = response.responseId;
  return {
    rawResponse,
    tokens: tokens(response),
    requestId: typeof requestId === "string" ? requestId : null,
  };
}

/** Constructs one nonretryable invalid Google envelope result. */
function rejected(response: NativeResponseEvidence | null): NativeAdmission {
  return {
    status: "rejected",
    error: createTransportError("invalid_response", "Google response was blocked or ambiguous"),
    response,
  };
}

/** Admits exactly one fully narrowed unblocked candidate with natural STOP. */
export function admitGoogleResponse(value: unknown): NativeAdmission {
  if (!isExternalObject(value)) return rejected(null);
  const result = candidateResult(value.candidates);
  const blocked = isBlocked(value.promptFeedback);
  const reached = result.text === null ? null : evidence(value, result.text);
  const invalid =
    result.candidate?.finishReason !== FinishReason.STOP || blocked !== false || reached === null;
  return invalid ? rejected(reached) : { status: "admitted", response: reached };
}
