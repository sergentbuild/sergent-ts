import { Ollama } from "ollama";
import { createPreAttemptModelFailure, createTransportError } from "sergent-ts-core";
import type { ModelClient, ModelIdentity, TransportError } from "sergent-ts-core";
import { createTransportClient, executeTransport } from "../transport/index.js";
import providerManifest from "../../package.json" with { type: "json" };
import type { OllamaRequest } from "./native.js";
import { ollamaRequest } from "./request.js";
import { admitOllamaResponse } from "./response.js";

/** Installed official Ollama SDK version owned by the provider package manifest. */
const OLLAMA_SDK_VERSION = providerManifest.dependencies.ollama;

/** Explicit Ollama endpoint and optional hermetic fetch seam. */
export interface OllamaModelClientConfig {
  readonly host?: string;
  readonly fetch?: typeof fetch;
}

/** Resolves the exact Ollama prefix and preserves the remaining model name. */
function modelIdentity(modelName: string): ModelIdentity | null {
  const prefix = "ollama/";
  if (!modelName.startsWith(prefix)) return null;
  const model = modelName.slice(prefix.length);
  if (model.trim().length === 0) return null;
  return {
    provider: "ollama",
    model,
    sdkPackage: "ollama",
    sdkVersion: OLLAMA_SDK_VERSION,
  };
}

/** Reads an Ollama HTTP status without depending on its private error class. */
function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const value = Reflect.get(error, "status_code");
  return typeof value === "number" ? value : null;
}

/** Maps Ollama boundary failures to the portable transport vocabulary. */
function classifyOllamaError(error: unknown): TransportError {
  const status = errorStatus(error);
  if (status === 404) return createTransportError("model_not_found", "Ollama model not found");
  if (status === 429) return createTransportError("rate_limited", "Ollama rate limit reached");
  if (status !== null && status >= 500) {
    return createTransportError("provider_unavailable", "Ollama service unavailable");
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return createTransportError("timeout", "Ollama request timed out");
  }
  if (error instanceof SyntaxError || error instanceof TypeError) {
    return createTransportError("provider_unavailable", "Ollama connection failed");
  }
  return createTransportError("provider_error", "Ollama request failed");
}

/** Invokes one request-scoped SDK client whose fetch owns the attempt signal. */
async function invokeOllama(
  config: OllamaModelClientConfig,
  body: OllamaRequest,
  signal: AbortSignal,
): Promise<unknown> {
  const nativeFetch = config.fetch ?? fetch;
  const invokeFetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(input, { ...init, signal });
  const attemptFetch: typeof fetch = Object.assign(invokeFetch, {
    preconnect: nativeFetch.preconnect,
  });
  const client = new Ollama({ host: config.host, fetch: attemptFetch });
  return client.chat(body);
}

/** Creates one Ollama ModelClient with explicit host configuration. */
export function createOllamaModelClient(config: OllamaModelClientConfig = {}): ModelClient {
  return createTransportClient(config, async (captured, request, signal, call) => {
    if (captured.host !== undefined && captured.host.trim().length === 0) {
      const error = createTransportError("missing_credentials", "Ollama host must not be blank");
      return createPreAttemptModelFailure(error);
    }
    const identity = modelIdentity(request.modelName);
    if (identity === null) {
      const error = createTransportError("invalid_model_name", "Ollama model prefix is invalid");
      return createPreAttemptModelFailure(error);
    }
    const body = ollamaRequest(request, identity.model);
    return executeTransport({
      call,
      identity,
      timeoutMs: request.modelSettings.timeoutMs,
      callerSignal: signal,
      invoke: async (attemptSignal) =>
        admitOllamaResponse(await invokeOllama(captured, body, attemptSignal)),
      classify: classifyOllamaError,
    });
  });
}
