import type {
  ChatCompletion,
  ChatCompletionFinishReason,
  CompletionUsage,
} from "@mlc-ai/web-llm/lib/openai_api_protocols/chat_completion.js";
import type { JsonObject, ModelTokens } from "sergent-ts-core";

/** The SDK's finish reason when the response has one choice. */
export type NativeFinishReason = ChatCompletionFinishReason | null;

/** Exact response facts reached before terminal timing arbitration. */
export interface ResponseEvidence {
  readonly rawResponse: string | null;
  readonly parsedJson: JsonObject | null;
  readonly tokens: ModelTokens | null;
  readonly requestId: string;
  readonly finishReason: NativeFinishReason;
}

/** A complete native token count must be a nonnegative safe integer. */
function tokenCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/** Preserves token evidence only when all counts and their checked sum agree. */
function tokens(value: CompletionUsage | undefined): ModelTokens | null {
  if (value === undefined) return null;
  const input = value.prompt_tokens;
  const output = value.completion_tokens;
  const total = value.total_tokens;
  if (!tokenCount(input) || !tokenCount(output) || !tokenCount(total)) return null;
  const sum = input + output;
  return Number.isSafeInteger(sum) && sum === total ? { input, output, total } : null;
}

/** Parses the admitted exact semantic text once, without salvage or typed decoding. */
function parseObject(text: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsedObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** JSON.parse already proved JSON leaves; only the required root object remains. */
function parsedObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Natural completion without a tool-call channel permits exact semantic text admission. */
function naturalAssistant(choice: ChatCompletion.Choice | undefined): boolean {
  return choice?.finish_reason === "stop" && choice.message.tool_calls === undefined;
}

/** Admits one naturally stopped assistant text choice and retains reached evidence. */
export function admitResponse(value: ChatCompletion, model: string): ResponseEvidence {
  const choice = value.choices.length === 1 ? value.choices[0] : undefined;
  const rawResponse = choice?.message.content ?? null;
  const envelopeOk = value.model === model && naturalAssistant(choice);
  const parsedJson = envelopeOk && rawResponse !== null ? parseObject(rawResponse) : null;
  return {
    rawResponse,
    parsedJson,
    tokens: tokens(value.usage),
    requestId: value.id,
    finishReason: choice?.finish_reason ?? null,
  };
}
