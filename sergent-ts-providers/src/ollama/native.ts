import type { ChatRequest } from "ollama";

/** Exact non-streaming Ollama request reused by every native attempt. */
export type OllamaRequest = ChatRequest & { readonly stream: false };
