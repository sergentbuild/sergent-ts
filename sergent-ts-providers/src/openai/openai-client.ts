import OpenAI, { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { VERSION } from "openai/version";
import { createPreAttemptModelFailure, createTransportError } from "sergent-ts-core";
import type { ModelClient, ModelIdentity, TransportError } from "sergent-ts-core";
import { createTransportClient, executeTransport } from "../transport/index.js";
import type { OpenAINativeClient, OpenAIRequestOptions } from "./native.js";
import { openAIRequest } from "./request.js";
import { admitOpenAIResponse } from "./response.js";

/** Explicit OpenAI credential and optional SDK-shaped test seams. */
export interface OpenAIModelClientConfig {
  readonly apiKey: string;
  readonly client?: OpenAINativeClient;
  readonly fetch?: typeof fetch;
}

/** Provider-owned marker for a failure while consuming an HTTP response body. */
class OpenAIResponseBodyReadError extends Error {}

/** Resolves the exact OpenAI prefix and preserves the remaining model name. */
function modelIdentity(modelName: string): ModelIdentity | null {
  const prefix = "openai/";
  if (!modelName.startsWith(prefix)) return null;
  const model = modelName.slice(prefix.length);
  if (model.trim().length === 0) return null;
  return { provider: "openai", model, sdkPackage: "openai", sdkVersion: VERSION };
}

/** Identifies authoritative SDK or owned-body connection failures. */
function isOpenAIConnectionFailure(error: unknown): boolean {
  return error instanceof APIConnectionError || error instanceof OpenAIResponseBodyReadError;
}

/** Maps typed OpenAI SDK errors and status facts to transport vocabulary. */
function classifyOpenAIError(error: unknown): TransportError {
  if (error instanceof APIConnectionTimeoutError) {
    return createTransportError("timeout", "OpenAI request timed out");
  }
  if (isOpenAIConnectionFailure(error)) {
    return createTransportError("provider_unavailable", "OpenAI response body read failed");
  }
  if (error instanceof SyntaxError || error instanceof TypeError) {
    return createTransportError("invalid_response", "OpenAI response envelope was malformed");
  }
  if (error instanceof APIError) {
    if (error.status === 404)
      return createTransportError("model_not_found", "OpenAI model not found");
    if (error.status === 429)
      return createTransportError("rate_limited", "OpenAI rate limit reached");
    if (error.status !== undefined && error.status >= 500) {
      return createTransportError("provider_unavailable", "OpenAI service unavailable");
    }
  }
  return createTransportError("provider_error", "OpenAI request failed");
}

/** Marks body-consumption failures before the SDK performs envelope conversion. */
function openAIFetch(nativeFetch: typeof fetch): typeof fetch {
  const invokeFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ): Promise<Response> => {
    const response = await nativeFetch(input, init);
    const readText = response.text.bind(response);
    Object.defineProperty(response, "text", {
      value: async (): Promise<string> => {
        try {
          return await readText();
        } catch {
          throw new OpenAIResponseBodyReadError();
        }
      },
    });
    return response;
  };
  return Object.assign(invokeFetch, { preconnect: nativeFetch.preconnect });
}

/** Creates the official client with native hidden retries disabled. */
function nativeClient(config: OpenAIModelClientConfig): OpenAINativeClient {
  if (config.client !== undefined) return config.client;
  const nativeFetch = config.fetch ?? fetch;
  const client = new OpenAI({
    apiKey: config.apiKey,
    maxRetries: 0,
    fetch: openAIFetch(nativeFetch),
  });
  return {
    responses: {
      create: async (
        body,
        options,
      ): Promise<Awaited<ReturnType<OpenAINativeClient["responses"]["create"]>>> =>
        client.responses.create(body, options),
    },
  };
}

/** Creates one OpenAI ModelClient with explicit credentials and no ambient lookup. */
export function createOpenAIModelClient(config: OpenAIModelClientConfig): ModelClient {
  return createTransportClient(config, async (captured, request, signal, call) => {
    if (captured.apiKey.trim().length === 0) {
      const error = createTransportError("missing_credentials", "OpenAI API key is required");
      return createPreAttemptModelFailure(error);
    }
    const identity = modelIdentity(request.modelName);
    if (identity === null) {
      const error = createTransportError("invalid_model_name", "OpenAI model prefix is invalid");
      return createPreAttemptModelFailure(error);
    }
    const body = openAIRequest(request, identity.model);
    const client = nativeClient(captured);
    return executeTransport({
      call,
      identity,
      timeoutMs: request.modelSettings.timeoutMs,
      callerSignal: signal,
      invoke: async (attemptSignal) => {
        const options: OpenAIRequestOptions = {
          maxRetries: 0,
          timeout: request.modelSettings.timeoutMs,
          signal: attemptSignal,
        };
        return admitOpenAIResponse(await client.responses.create(body, options));
      },
      classify: classifyOpenAIError,
    });
  });
}
