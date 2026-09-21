import type { MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/messages/messages";

/** Per-request options used to disable SDK retries and bind call controls. */
export interface AnthropicRequestOptions {
  readonly maxRetries: 0;
  readonly timeout: number;
  readonly signal: AbortSignal;
}

/** Narrow Anthropic response fields consumed at the external boundary. */
export interface AnthropicResponse {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly stop_details: unknown;
  readonly stop_reason: string | null;
  readonly usage: {
    readonly input_tokens: number;
    readonly cache_read_input_tokens: number | null;
    readonly cache_creation_input_tokens: number | null;
    readonly output_tokens: number;
  };
  readonly _request_id?: string | null;
}

/** Narrow official-client surface used by the adapter and SDK-shaped fakes. */
export interface AnthropicNativeClient {
  readonly messages: {
    create(
      body: MessageCreateParamsNonStreaming,
      options: AnthropicRequestOptions,
    ): Promise<unknown>;
  };
}

/** Exact non-streaming Anthropic request body used for every native attempt. */
export type AnthropicRequest = MessageCreateParamsNonStreaming;
