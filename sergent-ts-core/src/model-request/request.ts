import type { ProposalSchema } from "../schema/index.js";
import type { ModelMessages } from "./messages.js";

/** The complete portable model thinking-effort vocabulary. */
export type ThinkingEffort = "low" | "medium" | "high";

/** Construction proof for required phase-specific model settings. */
const modelSettingsBrand: unique symbol = Symbol("ModelSettings");

/** Required provider-portable settings for one model phase. */
export interface ModelSettings {
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly thinkingEffort: ThinkingEffort;
  readonly [modelSettingsBrand]: true;
}

/** One immutable provider-neutral model request. */
export interface ModelRequest {
  readonly modelName: string;
  readonly messages: ModelMessages;
  readonly proposalSchema: ProposalSchema;
  readonly modelSettings: ModelSettings;
}

/** Rejects a non-positive integral model setting. */
function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}

/** Rejects a thinking setting outside the portable closed vocabulary. */
function assertThinkingEffort(value: string): asserts value is ThinkingEffort {
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new TypeError("Thinking effort must be low, medium, or high");
  }
}

/** Constructs required phase-specific portable model settings. */
export function createModelSettings(
  maxOutputTokens: number,
  timeoutMs: number,
  thinkingEffort: ThinkingEffort,
): ModelSettings {
  assertPositiveInteger(maxOutputTokens, "Maximum output tokens");
  assertPositiveInteger(timeoutMs, "Timeout milliseconds");
  assertThinkingEffort(thinkingEffort);
  return {
    maxOutputTokens,
    timeoutMs,
    thinkingEffort,
    [modelSettingsBrand]: true as const,
  };
}

/** Combines runtime-owned selection and settings with Recipe-authored messages. */
export function createModelRequest(
  modelName: string,
  messages: ModelMessages,
  proposalSchema: ProposalSchema,
  modelSettings: ModelSettings,
): ModelRequest {
  return { modelName, messages, proposalSchema, modelSettings };
}
