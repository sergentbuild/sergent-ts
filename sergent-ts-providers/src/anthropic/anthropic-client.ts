import Anthropic, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "@anthropic-ai/sdk";
import { VERSION } from "@anthropic-ai/sdk/version";
import { createPreAttemptModelFailure, createTransportError } from "sergent-ts-core";
import type { ModelClient, ModelIdentity, TransportError } from "sergent-ts-core";
import { createTransportClient, executeTransport } from "../transport/index.js";
import type { AnthropicNativeClient, AnthropicRequestOptions } from "./native.js";
import { anthropicRequest } from "./request.js";
import { admitAnthropicResponse } from "./response.js";
import { isAnthropicSchemaCompatible } from "./schema.js";

/** Explicit Anthropic credential and optional SDK-shaped test seams. */
export interface AnthropicModelClientConfig {
  readonly apiKey: string;
  readonly client?: AnthropicNativeClient;
  readonly fetch?: typeof fetch;
}

/** Resolves the exact Anthropic prefix and preserves the remaining model name. */
function modelIdentity(modelName: string): ModelIdentity | null {
  const prefix = "anthropic/";
  if (!modelName.startsWith(prefix)) return null;
  const model = modelName.slice(prefix.length);
  if (model.trim().length === 0) return null;
  return { provider: "anthropic", model, sdkPackage: "@anthropic-ai/sdk", sdkVersion: VERSION };
}

/** Maps typed Anthropic SDK errors and status facts to transport vocabulary. */
function classifyAnthropicError(error: unknown): TransportError {
  if (error instanceof APIConnectionTimeoutError) {
    return createTransportError("timeout", "Anthropic request timed out");
  }
  if (
    error instanceof APIConnectionError ||
    error instanceof SyntaxError ||
    error instanceof TypeError
  ) {
    return createTransportError("provider_unavailable", "Anthropic connection failed");
  }
  if (error instanceof APIError) {
    if (error.status === 404)
      return createTransportError("model_not_found", "Anthropic model not found");
    if (error.status === 429)
      return createTransportError("rate_limited", "Anthropic rate limit reached");
    if (error.status !== undefined && error.status >= 500) {
      return createTransportError("provider_unavailable", "Anthropic service unavailable");
    }
  }
  return createTransportError("provider_error", "Anthropic request failed");
}

/** Creates the official client with native hidden retries disabled. */
function nativeClient(config: AnthropicModelClientConfig): AnthropicNativeClient {
  if (config.client !== undefined) return config.client;
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 0, fetch: config.fetch });
  return {
    messages: {
      create: async (
        body,
        options,
      ): Promise<Awaited<ReturnType<AnthropicNativeClient["messages"]["create"]>>> =>
        client.messages.create(body, options),
    },
  };
}

/** Creates one Anthropic ModelClient with explicit credentials and no ambient lookup. */
export function createAnthropicModelClient(config: AnthropicModelClientConfig): ModelClient {
  return createTransportClient(config, async (captured, request, signal, call) => {
    if (captured.apiKey.trim().length === 0) {
      const error = createTransportError("missing_credentials", "Anthropic API key is required");
      return createPreAttemptModelFailure(error);
    }
    const identity = modelIdentity(request.modelName);
    if (identity === null) {
      const error = createTransportError("invalid_model_name", "Anthropic model prefix is invalid");
      return createPreAttemptModelFailure(error);
    }
    if (!isAnthropicSchemaCompatible(request.proposalSchema)) {
      const error = createTransportError(
        "invalid_payload",
        "Anthropic cannot carry this canonical schema unchanged",
      );
      return createPreAttemptModelFailure(error, identity);
    }
    const body = anthropicRequest(request, identity.model);
    const client = nativeClient(captured);
    return executeTransport({
      call,
      identity,
      timeoutMs: request.modelSettings.timeoutMs,
      callerSignal: signal,
      invoke: async (attemptSignal) => {
        const options: AnthropicRequestOptions = {
          maxRetries: 0,
          timeout: request.modelSettings.timeoutMs,
          signal: attemptSignal,
        };
        return admitAnthropicResponse(await client.messages.create(body, options));
      },
      classify: classifyAnthropicError,
    });
  });
}
