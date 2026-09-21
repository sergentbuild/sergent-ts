import type { ChatCompletion } from "@mlc-ai/web-llm/lib/openai_api_protocols/chat_completion.js";
import {
  cancelledError,
  createFailedModelAttempt,
  createModelCancellation,
  createModelFailure,
  createModelSuccess,
  createPreAttemptModelFailure,
  createSuccessfulModelAttempt,
  createTransportError,
} from "sergent-ts-core";
import type {
  ModelAttemptTiming,
  ModelIdentity,
  ModelOutcome,
  ModelRequest,
  TransportFailureKind,
} from "sergent-ts-core";
import { PendingWork } from "../lifecycle/index.js";
import type { WorkClock } from "../lifecycle/index.js";
import { admitResponse, modelIdentity } from "../native/index.js";
import type {
  DiagnosticReporter,
  NativeEngine,
  NativeRequest,
  ResponseEvidence,
} from "../native/index.js";

/** One invocation's captured timing origin and non-controlling native observation. */
interface InvocationObservation {
  readonly startedAt: number;
  readonly report: DiagnosticReporter;
}

/** The timing facts that exist only after native completion dispatch begins. */
interface AttemptStart {
  readonly at: string;
  readonly tick: number;
}

/** One exclusive reset/completion lifecycle with a single local terminal owner. */
export class Invocation {
  readonly work: PendingWork<ModelOutcome>;
  readonly #identity: ModelIdentity;
  readonly #callStart: number;
  readonly #report: DiagnosticReporter;
  #attempt: AttemptStart | null = null;

  /** Captures one request and installs abort handling before any reset. */
  constructor(
    private readonly request: ModelRequest,
    private readonly native: NativeRequest,
    signal: AbortSignal,
    private readonly clock: WorkClock,
    private readonly release: (unavailable: boolean) => void,
    observation: InvocationObservation,
  ) {
    this.#identity = modelIdentity(native.model);
    this.#callStart = observation.startedAt;
    this.#report = observation.report;
    this.work = new PendingWork(clock, signal, () => this.cancel());
  }

  /** Starts the independently bounded reset while holding exclusive engine ownership. */
  start(engine: NativeEngine): void {
    if (this.work.done) return;
    this.work.deadline(5_000, () => this.setupFailure("reset_timeout"));
    this.#report({ event: "reset_start", timeoutMs: 5_000 });
    void engine.resetChat(false, this.#identity.model).then(
      () => {
        if (this.work.done) return;
        this.#report({ event: "reset_complete" });
        if (this.work.expired) this.setupFailure("reset_timeout");
        else this.dispatch(engine);
      },
      () => this.setupFailure(),
    );
  }

  /** Cancels local work immediately, without retaining an interrupted attempt. */
  cancel(): void {
    this.work.settle(
      createModelCancellation(cancelledError("Local model work was cancelled"), this.#identity),
      () => {
        this.#report({ event: "invocation_cancelled" });
        this.release(true);
      },
    );
  }

  /** Attributes explicit worker event failure to its known external provenance. */
  workerFailure(): void {
    if (this.#attempt === null) this.setupFailure();
    else this.fail("provider_unavailable", null, true);
  }

  /** Disposes a failed reset without claiming a completion attempt. */
  private setupFailure(event: "reset_failed" | "reset_timeout" = "reset_failed"): void {
    const error = createTransportError(
      "invalid_payload",
      "The local model session is unavailable",
      { reason: "session_unavailable" },
    );
    this.work.settle(createPreAttemptModelFailure(error, this.#identity), () => {
      this.#report({ event, errorKind: error.kind });
      this.release(true);
    });
  }

  /** Starts attempt timing and the model deadline immediately at native dispatch. */
  private dispatch(engine: NativeEngine): void {
    this.#attempt = { at: this.clock.timestamp(), tick: this.clock.now() };
    this.work.deadline(this.request.modelSettings.timeoutMs, () =>
      this.fail("timeout", null, true),
    );
    this.#report({ event: "completion_dispatch", timeoutMs: this.request.modelSettings.timeoutMs });
    void engine.chatCompletion(this.native).then(
      (response) => this.receive(response),
      () => {
        this.fail(this.work.expired ? "timeout" : "provider_error", null, true);
      },
    );
  }

  /** Admits the returned response before closing the complete attempt span. */
  private receive(response: ChatCompletion): void {
    if (this.work.done) return;
    this.#report({ event: "completion_received" });
    const evidence = admitResponse(response, this.#identity.model);
    this.#report({
      event: "response_admission",
      accepted: evidence.parsedJson !== null,
      finishReason: evidence.finishReason,
      tokens: evidence.tokens,
    });
    if (this.work.expired) {
      this.fail("timeout", evidence, true);
      return;
    }
    if (evidence.rawResponse === null || evidence.parsedJson === null) {
      this.fail("invalid_response", evidence, false);
      return;
    }
    const outcome = createModelSuccess(
      this.#identity,
      [createSuccessfulModelAttempt(this.timing())],
      evidence.rawResponse,
      evidence.parsedJson,
      this.usage(evidence),
    );
    this.work.settle(outcome, () => {
      this.#report({ event: "completion_success" });
      this.release(false);
    });
  }

  /** Projects only a dispatched attempt's closed wall and monotonic span. */
  private timing(): ModelAttemptTiming {
    if (this.#attempt === null) throw new TypeError("Completion timing requires native dispatch");
    return {
      startedAt: this.#attempt.at,
      finishedAt: this.clock.timestamp(),
      durationMs: Math.floor(this.clock.now() - this.#attempt.tick),
    };
  }

  /** Computes whole-call latency independently of native token and speed reporting. */
  private usage(evidence: ResponseEvidence): import("sergent-ts-core").ModelUsage {
    return {
      latencyMs: Math.floor(this.clock.now() - this.#callStart),
      tokens: evidence.tokens,
      requestId: evidence.requestId,
    };
  }

  /** Closes one failed dispatched attempt and retains only reached response facts. */
  private fail(
    kind: TransportFailureKind,
    evidence: ResponseEvidence | null,
    unavailable: boolean,
  ): void {
    if (this.work.done) return;
    const error = createTransportError(kind, "The local model completion failed");
    const response =
      evidence?.rawResponse !== null && evidence !== null
        ? {
            rawResponse: evidence.rawResponse,
            parsedJson: evidence.parsedJson,
            usage: this.usage(evidence),
          }
        : null;
    const outcome = createModelFailure(
      this.#identity,
      [createFailedModelAttempt(this.timing(), error)],
      response,
    );
    this.work.settle(outcome, () => {
      this.#report({
        event: kind === "timeout" ? "completion_timeout" : "completion_failed",
        errorKind: kind,
      });
      this.release(unavailable);
    });
  }
}
