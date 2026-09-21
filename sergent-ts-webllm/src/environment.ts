import { CLOCK } from "./lifecycle/index.js";
import type { WorkClock } from "./lifecycle/index.js";
import { createNativeEngine } from "./native/index.js";
import type { NativeEngine, WebLlmProfile, WebLlmProgress, WebLlmWorker } from "./native/index.js";
import type { WebLlmUnavailableReason } from "./types.js";

/** External capability and official proxy construction kept separate from local lifecycle. */
export interface SessionEnvironment {
  readonly clock: WorkClock;
  /** Probes actual platform capability before model download. */
  probe(): Promise<WebLlmUnavailableReason | null>;
  /** Constructs the native engine over the session's one owned worker. */
  createEngine(
    worker: WebLlmWorker,
    profile: WebLlmProfile,
    progress: (report: WebLlmProgress) => void,
  ): NativeEngine;
}

/** Checks the platform once; a successful adapter does not promise model load success. */
async function probe(): Promise<WebLlmUnavailableReason | null> {
  if (!globalThis.isSecureContext) return "insecure_context";
  if (!("gpu" in navigator)) return "webgpu_unavailable";
  const gpu = navigator.gpu as { requestAdapter(): Promise<unknown> };
  return (await gpu.requestAdapter()) === null ? "webgpu_unavailable" : null;
}

/** Default browser boundaries; lifecycle tests supply native-shaped deterministic alternatives. */
export const ENVIRONMENT: SessionEnvironment = {
  clock: CLOCK,
  probe,
  createEngine: createNativeEngine,
};
