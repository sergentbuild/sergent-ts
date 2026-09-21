import { ApiError, GoogleGenAI } from "@google/genai";
import { createPreAttemptModelFailure, createTransportError } from "sergent-ts-core";
import type { ModelClient, ModelIdentity, TransportError } from "sergent-ts-core";
import { createTransportClient, executeTransport } from "../transport/index.js";
import providerManifest from "../../package.json" with { type: "json" };
import type { GoogleNativeClient } from "./native.js";
import { googleAttemptRequest, googleRequest } from "./request.js";
import { admitGoogleResponse } from "./response.js";

/** Installed official Google SDK version owned by the provider package manifest. */
const GOOGLE_SDK_VERSION = providerManifest.dependencies["@google/genai"];

/** Explicit Google credential and optional SDK-shaped client seam. */
export interface GoogleModelClientConfig {
  readonly apiKey: string;
  readonly client?: GoogleNativeClient;
}

/** Resolves the exact Google prefix and preserves the remaining model name. */
function modelIdentity(modelName: string): ModelIdentity | null {
  const prefix = "google/";
  if (!modelName.startsWith(prefix)) return null;
  const model = modelName.slice(prefix.length);
  if (model.trim().length === 0) return null;
  return {
    provider: "google",
    model,
    sdkPackage: "@google/genai",
    sdkVersion: GOOGLE_SDK_VERSION,
  };
}

/** Maps a reached Google API status to a portable transport error. */
function classifyGoogleStatus(error: ApiError): TransportError | null {
  if (error.status === 404)
    return createTransportError("model_not_found", "Google model not found");
  if (error.status === 429)
    return createTransportError("rate_limited", "Google rate limit reached");
  if (error.status >= 500) {
    return createTransportError("provider_unavailable", "Google service unavailable");
  }
  return null;
}

/**
 * Maps Google status facts and thrown error classes to transport vocabulary,
 * accepting that a null or primitive JSON body shares the retryable TypeError
 * classification because no reached fact separates it from a failed body read.
 */
function classifyGoogleError(error: unknown): TransportError {
  if (error instanceof ApiError) {
    const statusError = classifyGoogleStatus(error);
    if (statusError !== null) return statusError;
  }
  if (error instanceof TypeError) {
    return createTransportError("provider_unavailable", "Google connection failed");
  }
  if (error instanceof SyntaxError) {
    return createTransportError("invalid_response", "Google response envelope was malformed");
  }
  return createTransportError("provider_error", "Google request failed");
}

/** Creates the official Gemini Developer API client with hidden retries disabled. */
function nativeClient(config: GoogleModelClientConfig): GoogleNativeClient {
  if (config.client !== undefined) return config.client;
  return new GoogleGenAI({
    apiKey: config.apiKey,
    vertexai: false,
    httpOptions: { retryOptions: { attempts: 1 } },
  });
}

/** Creates one Google ModelClient with explicit credentials and no ambient lookup. */
export function createGoogleModelClient(config: GoogleModelClientConfig): ModelClient {
  return createTransportClient(config, async (captured, request, signal, call) => {
    if (captured.apiKey.trim().length === 0) {
      const error = createTransportError("missing_credentials", "Google API key is required");
      return createPreAttemptModelFailure(error);
    }
    const identity = modelIdentity(request.modelName);
    if (identity === null) {
      const error = createTransportError("invalid_model_name", "Google model prefix is invalid");
      return createPreAttemptModelFailure(error);
    }
    const body = googleRequest(request, identity.model);
    const client = nativeClient(captured);
    return executeTransport({
      call,
      identity,
      timeoutMs: request.modelSettings.timeoutMs,
      callerSignal: signal,
      invoke: async (attemptSignal) => {
        const attemptBody = googleAttemptRequest(body, attemptSignal);
        return admitGoogleResponse(await client.models.generateContent(attemptBody));
      },
      classify: classifyGoogleError,
    });
  });
}
