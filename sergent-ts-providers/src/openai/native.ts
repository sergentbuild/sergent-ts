import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

/** Per-request options used to disable SDK retries and bind call controls. */
export interface OpenAIRequestOptions {
  readonly maxRetries: 0;
  readonly timeout: number;
  readonly signal: AbortSignal;
}

/** Narrow OpenAI response fields consumed at the external boundary. */
export interface OpenAIResponse {
  readonly error: unknown;
  readonly incomplete_details: unknown;
  readonly output: readonly {
    readonly type: string;
    readonly content?: readonly { readonly type: string; readonly refusal?: string }[];
  }[];
  readonly output_text: string;
  readonly status?: string;
  readonly usage?: { readonly input_tokens: number; readonly output_tokens: number };
  readonly _request_id?: string | null;
}

/** Narrow official-client surface used by the adapter and SDK-shaped fakes. */
export interface OpenAINativeClient {
  readonly responses: {
    create(body: ResponseCreateParamsNonStreaming, options: OpenAIRequestOptions): Promise<unknown>;
  };
}

/** Exact non-streaming OpenAI request body used for every native attempt. */
export type OpenAIRequest = ResponseCreateParamsNonStreaming;
