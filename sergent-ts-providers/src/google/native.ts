import type { GenerateContentParameters } from "@google/genai";

/** Google response fields consumed by envelope admission and evidence capture. */
export interface GoogleResponse {
  readonly candidates?: readonly {
    readonly finishReason?: string;
    readonly content?: {
      readonly role?: string;
      readonly parts?: readonly {
        readonly text?: string;
        readonly thought?: boolean;
      }[];
    };
  }[];
  readonly promptFeedback?: { readonly blockReason?: string };
  readonly responseId?: string;
  readonly usageMetadata?: {
    readonly promptTokenCount?: number;
    readonly totalTokenCount?: number;
  };
}

/** Narrow official-client surface used by the adapter and SDK-shaped fakes. */
export interface GoogleNativeClient {
  readonly models: {
    generateContent(body: GenerateContentParameters): Promise<unknown>;
  };
}

/** Exact Google request parameters used for each native attempt. */
export type GoogleRequest = GenerateContentParameters;
