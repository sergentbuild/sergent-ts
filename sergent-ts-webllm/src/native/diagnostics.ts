import type { ModelTokens } from "sergent-ts-core";
import type { WorkClock } from "../lifecycle/index.js";
import type { NativeFinishReason } from "./response.js";

/** Reached provider boundaries with timing and safe native metadata. */
export interface WebLlmDiagnostic {
  readonly event:
    | "load_start"
    | "probe_start"
    | "probe_complete"
    | "worker_created"
    | "model_load_start"
    | "model_load_complete"
    | "load_ready"
    | "load_failed"
    | "load_cancelled"
    | "load_timeout"
    | "reset_start"
    | "reset_complete"
    | "reset_failed"
    | "reset_timeout"
    | "completion_dispatch"
    | "completion_received"
    | "response_admission"
    | "completion_success"
    | "completion_failed"
    | "completion_timeout"
    | "invocation_cancelled"
    | "request_rejected"
    | "worker_failure"
    | "worker_disposed"
    | "session_closed";
  readonly at: string;
  readonly elapsedMs: number;
  readonly timeoutMs?: number;
  readonly errorKind?: string;
  readonly finishReason?: NativeFinishReason;
  readonly tokens?: ModelTokens | null;
  readonly accepted?: boolean;
}

/** Internal producers supply reached metadata; one reporter adds timing and contains delivery. */
export type DiagnosticReporter = (event: Omit<WebLlmDiagnostic, "at" | "elapsedMs">) => void;

/** Captures the observation interval without taking any execution or deadline authority. */
export function diagnosticReporter(
  callback: ((event: WebLlmDiagnostic) => void) | undefined,
  clock: WorkClock,
  started: number,
): DiagnosticReporter {
  return (event) => {
    try {
      callback?.({ ...event, at: clock.timestamp(), elapsedMs: Math.floor(clock.now() - started) });
    } catch {
      // Observation never controls the native operation or its terminal result.
    }
  };
}
