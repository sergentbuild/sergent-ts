import { ENVIRONMENT } from "./environment.js";
import { Session } from "./session.js";
import type { WebLlmSession, WebLlmSessionConfig } from "./types.js";

/** Captures one immutable browser session policy without loading or creating a worker. */
export function createWebLlmSession(config: WebLlmSessionConfig): WebLlmSession {
  if (!Number.isSafeInteger(config.loadTimeoutMs) || config.loadTimeoutMs <= 0)
    throw new TypeError("Load timeout must be a positive safe integer");
  const profile = { ...config.profile, stopTokenIds: [...config.profile.stopTokenIds] };
  if (!Number.isSafeInteger(profile.contextWindowSize) || profile.contextWindowSize <= 0)
    throw new TypeError("Context window must be a positive safe integer");
  return new Session({ ...config, profile }, ENVIRONMENT);
}
