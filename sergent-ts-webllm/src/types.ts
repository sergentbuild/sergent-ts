import type { ModelClient } from "sergent-ts-core";
import type {
  WebLlmDiagnostic,
  WebLlmProfile,
  WebLlmProgress,
  WebLlmWorker,
} from "./native/index.js";

/** Safe setup reasons never containing native exception prose. */
export type WebLlmUnavailableReason =
  | "insecure_context"
  | "webgpu_unavailable"
  | "load_failed"
  | "load_timeout"
  | "worker_failure"
  | "session_unavailable"
  | "cancelled";

/** Public readiness is owned by the session rather than copied by its consumers. */
export type WebLlmState =
  | Readonly<{ kind: "cold" | "ready" | "running" | "closed" }>
  | Readonly<{ kind: "loading"; progress: WebLlmProgress | null }>
  | Readonly<{ kind: "unavailable"; reason: WebLlmUnavailableReason }>;

/** Setup has no model attempts and resolves independently of a Sergent run. */
export type WebLlmLoadResult =
  | Readonly<{ status: "ready" }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ status: "unavailable"; reason: WebLlmUnavailableReason }>;

/** Construction captures one worker factory, profile, and non-controlling observer. */
export interface WebLlmSessionConfig {
  readonly workerFactory: () => WebLlmWorker;
  readonly profile: WebLlmProfile;
  readonly loadTimeoutMs: number;
  readonly onStateChange: (state: WebLlmState) => void;
  readonly onDiagnostic?: (event: WebLlmDiagnostic) => void;
}

/** One explicit load, exclusive client use while ready, and immediate final close. */
export interface WebLlmSession {
  readonly client: ModelClient;
  readonly state: WebLlmState;
  /** Starts the one-shot load after checking actual secure-context/WebGPU capability. */
  load(signal: AbortSignal): Promise<WebLlmLoadResult>;
  /** Immediately disposes and cancels pending work; repeated close has no effect. */
  close(): void;
}
