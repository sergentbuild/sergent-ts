import {
  cancelledError,
  createModelCancellation,
  createPreAttemptModelFailure,
} from "sergent-ts-core";
import type { ModelClient, ModelOutcome, ModelRequest } from "sergent-ts-core";
import { Invocation } from "./call/index.js";
import type { SessionEnvironment } from "./environment.js";
import { PendingWork } from "./lifecycle/index.js";
import {
  admitRequest,
  diagnosticReporter,
  modelIdentity,
  nativeLoadOptions,
} from "./native/index.js";
import type {
  DiagnosticReporter,
  NativeEngine,
  WebLlmProgress,
  WebLlmWorker,
} from "./native/index.js";
import type {
  WebLlmLoadResult,
  WebLlmSession,
  WebLlmSessionConfig,
  WebLlmState,
  WebLlmUnavailableReason,
} from "./types.js";

/** The worker and official proxy share exactly one disposal lifetime. */
interface Resource {
  readonly worker: WebLlmWorker;
  engine: NativeEngine | null;
}

/** Only the active operation owns its cancellation and worker-failure result. */
interface Pending {
  /** Cancels the current operation without waiting for native work. */
  cancel(): void;
  /** Settles a known worker fault at the current operation's reached phase. */
  workerFailure(): void;
}

/** Owns one worker and exclusive local work, with no recovery or replacement path. */
export class Session implements WebLlmSession {
  readonly client: ModelClient;
  #state: WebLlmState = { kind: "cold" };
  #resource: Resource | null = null;
  #pending: Pending | null = null;
  #report: DiagnosticReporter;
  readonly #workerFault = (): void => {
    this.#report({ event: "worker_failure" });
    if (this.#pending) this.#pending.workerFailure();
    else this.finish("worker_failure");
  };

  /** Captures caller-owned configuration before any asynchronous lifetime starts. */
  constructor(
    private readonly config: WebLlmSessionConfig,
    private readonly environment: SessionEnvironment,
  ) {
    this.#report = diagnosticReporter(
      config.onDiagnostic,
      environment.clock,
      environment.clock.now(),
    );
    this.client = { invoke: (request, signal) => this.invoke(request, signal) };
  }

  /** Exposes the session's authoritative readonly state. */
  get state(): WebLlmState {
    return this.#state;
  }

  /** Starts the only load operation and bounds probing, download, and initialization together. */
  load(signal: AbortSignal): Promise<WebLlmLoadResult> {
    if (this.#state.kind !== "cold") throw new TypeError("WebLLM load is one-shot from cold");
    this.#report = diagnosticReporter(
      this.config.onDiagnostic,
      this.environment.clock,
      this.environment.clock.now(),
    );
    this.#report({ event: "load_start", timeoutMs: this.config.loadTimeoutMs });
    const work = new PendingWork<WebLlmLoadResult>(this.environment.clock, signal, () => cancel());
    const cancel = (): void =>
      work.settle({ status: "cancelled" }, () => {
        this.#report({ event: "load_cancelled" });
        this.finish("cancelled");
      });
    const fail = (reason: WebLlmUnavailableReason): void =>
      work.settle({ status: "unavailable", reason }, () => {
        this.#report({
          event: reason === "load_timeout" ? "load_timeout" : "load_failed",
          errorKind: reason,
        });
        this.finish(reason);
      });
    this.#pending = { cancel, workerFailure: () => fail("worker_failure") };
    if (signal.aborted) {
      cancel();
      return work.promise;
    }
    work.deadline(this.config.loadTimeoutMs, () => fail("load_timeout"));
    this.publish({ kind: "loading", progress: null });
    if (!work.done) void this.prepare(work, fail);
    return work.promise;
  }

  /** Probes and loads while late native settlements remain unable to revive disposed work. */
  private async prepare(
    work: PendingWork<WebLlmLoadResult>,
    fail: (reason: WebLlmUnavailableReason) => void,
  ): Promise<void> {
    try {
      this.#report({ event: "probe_start" });
      const reason = await this.environment.probe();
      if (work.done) return;
      this.#report({ event: "probe_complete" });
      if (work.expired) {
        fail("load_timeout");
        return;
      }
      if (reason !== null) {
        fail(reason);
        return;
      }
      const worker = this.config.workerFactory();
      this.#resource = { worker, engine: null };
      this.#report({ event: "worker_created" });
      worker.addEventListener("error", this.#workerFault);
      worker.addEventListener("messageerror", this.#workerFault);
      const engine = this.environment.createEngine(worker, this.config.profile, (report) =>
        this.progress(report),
      );
      this.#resource.engine = engine;
      this.#report({ event: "model_load_start" });
      void engine.reload(this.config.profile.modelId, nativeLoadOptions(this.config.profile)).then(
        () => {
          if (work.done) return;
          this.#report({ event: "model_load_complete" });
          if (work.expired) fail("load_timeout");
          else
            work.settle({ status: "ready" }, () => {
              this.#report({ event: "load_ready" });
              this.finish(null);
            });
        },
        () => fail("load_failed"),
      );
    } catch {
      fail("load_failed");
    }
  }

  /** Projects upstream loading facts without allowing callback failure to control work. */
  private progress(report: WebLlmProgress): void {
    if (this.#state.kind === "loading")
      this.publish({
        kind: "loading",
        progress: { progress: report.progress, timeElapsed: report.timeElapsed, text: report.text },
      });
  }

  /** Takes exclusive engine ownership only after provider-specific request admission. */
  private invoke(request: ModelRequest, signal: AbortSignal): Promise<ModelOutcome> {
    const callStart = this.environment.clock.now();
    if (this.#state.kind !== "ready" || this.#resource?.engine == null)
      throw new TypeError("WebLLM client requires a ready session");
    this.#report = diagnosticReporter(this.config.onDiagnostic, this.environment.clock, callStart);
    if (signal.aborted) {
      this.#report({ event: "invocation_cancelled" });
      return Promise.resolve(
        createModelCancellation(cancelledError("Local model work was cancelled"), null),
      );
    }
    const admitted = admitRequest(request, this.config.profile);
    if (!admitted.ok) {
      this.#report({ event: "request_rejected", errorKind: admitted.error.kind });
      return Promise.resolve(
        createPreAttemptModelFailure(
          admitted.error,
          admitted.error.kind === "invalid_model_name"
            ? null
            : modelIdentity(this.config.profile.modelId),
        ),
      );
    }
    const engine = this.#resource.engine;
    const invocation = new Invocation(
      request,
      admitted.request,
      signal,
      this.environment.clock,
      (unavailable) => this.finish(unavailable ? "session_unavailable" : null),
      { startedAt: callStart, report: this.#report },
    );
    this.#pending = invocation;
    this.publish({ kind: "running" });
    invocation.start(engine);
    return invocation.work.promise;
  }

  /** Releases active ownership before notifying observers of its terminal state. */
  private finish(reason: WebLlmUnavailableReason | null): void {
    this.#pending = null;
    if (reason !== null) this.dispose();
    if (this.#state.kind !== "closed")
      this.publish(reason === null ? { kind: "ready" } : { kind: "unavailable", reason });
  }

  /** Detaches every owned worker callback and discards the unusable proxy immediately. */
  private dispose(): void {
    const resource = this.#resource;
    this.#resource = null;
    if (resource === null) return;
    Object.assign(resource.worker, { onmessage: null });
    resource.worker.removeEventListener("error", this.#workerFault);
    resource.worker.removeEventListener("messageerror", this.#workerFault);
    resource.worker.terminate();
    this.#report({ event: "worker_disposed" });
  }

  /** Changes authoritative state while containing ordinary display callback exceptions. */
  private publish(state: WebLlmState): void {
    this.#state = state;
    try {
      this.config.onStateChange(state);
    } catch {
      /* Notifications do not control the session. */
    }
  }

  /** Immediately closes the session and cancels pending local work exactly once. */
  close(): void {
    if (this.#state.kind === "closed") return;
    this.#state = { kind: "closed" };
    this.#report({ event: "session_closed" });
    this.dispose();
    this.#pending?.cancel();
    this.publish(this.#state);
  }
}
