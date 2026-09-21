import type {
  ChatCompletion,
  ChatCompletionRequestNonStreaming,
} from "@mlc-ai/web-llm/lib/openai_api_protocols/chat_completion.js";
import type { ChatOptions } from "@mlc-ai/web-llm/lib/config.js";

/** The application-owned immutable model assets and qualified native load settings. */
export interface WebLlmProfile {
  readonly modelId: string;
  readonly modelUrl: string;
  readonly modelLibraryUrl: string;
  readonly contextWindowSize: number;
  readonly maxHistorySize: number;
  readonly temperature: number;
  readonly stopTokenIds: readonly number[];
  readonly roleEmptySeparator: string;
}

/** Only the upstream progress facts needed by the loading presentation. */
export interface WebLlmProgress {
  readonly progress: number;
  readonly timeElapsed: number;
  readonly text: string;
}

/** The dedicated worker capabilities consumed by the official proxy and its owner. */
export interface WebLlmWorker extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null;
  /** Sends native serializable protocol data to the dedicated worker. */
  postMessage(message: unknown): void;
  /** Immediately stops the worker without a native acknowledgment. */
  terminate(): void;
}

/** The native SDK methods used by this provider, preserving its constructed response type. */
export interface NativeEngine {
  /** Initializes the configured model with captured load overrides. */
  reload(model: string, options: ChatOptions): Promise<void>;
  /** Clears conversation and usage before each independent request. */
  resetChat(keepStats: boolean, model: string): Promise<void>;
  /** Dispatches one non-streaming native completion. */
  chatCompletion(request: ChatCompletionRequestNonStreaming): Promise<ChatCompletion>;
}

/** Native completion data containing only serializable fields. */
export type NativeRequest = ChatCompletionRequestNonStreaming & { readonly model: string };
