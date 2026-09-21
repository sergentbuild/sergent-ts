import type {
  JsonObject,
  ModelAttempt,
  ModelIdentity,
  ModelOutcome,
  ModelRequest,
  ModelUsage,
  RunError,
} from "sergent-ts-core";

import { captureModelRequest, captureValue, projectSchemaObject } from "../capture/index.js";
import type {
  CapturedValue,
  ModelAttemptRecord,
  ModelCallRecord,
  ModelIdentityRecord,
  ModelUsageRecord,
  ProposalSchemaRecord,
} from "../records/index.js";

/** Reached model-call states that constrain typed proposal and step closure. */
type ModelCallState =
  | "open"
  | "provider_success"
  | "provider_failure"
  | "provider_cancelled"
  | "invocation_failure"
  | "interrupted"
  | "closed";

/** Outcome state and its optional authoritative terminal error owner. */
interface ModelCallLifecycle {
  readonly state: ModelCallState;
  readonly outcomeError: RunError | null;
}

/** Terminal status of the enclosing reached step. */
type StepTerminalStatus = "success" | "failure" | "cancelled";

/** Projects one resolved provider identity to its Run Record fields. */
function modelIdentity(identity: ModelIdentity | null): ModelIdentityRecord | null {
  if (identity === null) return null;
  return {
    provider: identity.provider,
    model: identity.model,
    sdk_package: identity.sdkPackage,
    sdk_version: identity.sdkVersion,
  };
}

/** Projects one complete provider attempt without duplicating usage. */
function modelAttempt(attempt: ModelAttempt): ModelAttemptRecord {
  const timing = {
    started_at: attempt.timing.startedAt,
    finished_at: attempt.timing.finishedAt,
    duration_ms: attempt.timing.durationMs,
  };
  if (attempt.status === "success") {
    return { timing, status: "success", retryable: null, error: null };
  }
  return {
    timing,
    status: "failure",
    retryable: attempt.retryable,
    error: attempt.error,
  };
}

/** Projects reached whole-call usage without inventing missing token facts. */
function modelUsage(usage: ModelUsage | null): ModelUsageRecord | null {
  if (usage === null) return null;
  return {
    latency_ms: usage.latencyMs,
    tokens: usage.tokens === null ? null : { ...usage.tokens },
    request_id: usage.requestId,
  };
}

/** Captures the exact canonical schema carried by the request. */
function proposalSchema(request: ModelRequest): ProposalSchemaRecord {
  return {
    name: request.proposalSchema.name,
    json_schema: projectSchemaObject(request.proposalSchema.json_schema),
  };
}

/** Mutable owner for one reached model call's request and returned evidence. */
export class ModelCallRecordBuilder {
  readonly #proposalSchema: ProposalSchemaRecord;
  readonly #modelName: string;
  readonly #request: CapturedValue;
  #identity: ModelIdentityRecord | null = null;
  #rawResponse: string | null = null;
  #parsedJson: JsonObject | null = null;
  #parsedProposal: CapturedValue | null = null;
  #usage: ModelUsageRecord | null = null;
  #attempts: readonly ModelAttemptRecord[] = [];
  #lifecycle: ModelCallLifecycle = { state: "open", outcomeError: null };

  /** Opens a call with request capture and exact ProposalSchema evidence. */
  public constructor(request: ModelRequest) {
    this.#proposalSchema = proposalSchema(request);
    this.#modelName = request.modelName;
    this.#request = captureModelRequest(request);
  }

  /** Completes provider evidence exactly once from its single outcome owner. */
  public complete(outcome: ModelOutcome): void {
    if (this.#lifecycle.state !== "open") {
      throw new TypeError("Model call outcome is already settled");
    }
    this.#identity = modelIdentity(outcome.identity);
    this.#attempts = outcome.attempts.map(modelAttempt);
    this.#rawResponse = outcome.rawResponse;
    this.#parsedJson = outcome.parsedJson === null ? null : structuredClone(outcome.parsedJson);
    this.#usage = modelUsage(outcome.usage);
    this.#lifecycle = {
      state: `provider_${outcome.status}`,
      outcomeError: outcome.status === "success" ? null : outcome.error,
    };
  }

  /** Closes an interrupted call while retaining only its request capture. */
  public interrupt(): void {
    if (this.#lifecycle.state !== "open") {
      throw new TypeError("Model call outcome is already settled");
    }
    this.#lifecycle = { state: "interrupted", outcomeError: null };
  }

  /** Settles an unexpected adapter throw with request-only failure evidence. */
  public failInvocation(error: RunError<"internal_error">): void {
    if (this.#lifecycle.state !== "open") {
      throw new TypeError("Model call outcome is already settled");
    }
    this.#lifecycle = { state: "invocation_failure", outcomeError: error };
  }

  /** Adds a typed proposal only after the model-output crossing succeeds. */
  public recordParsedProposal(value: unknown): void {
    if (this.#lifecycle.state !== "provider_success") {
      throw new TypeError("Typed proposal requires a successful provider outcome");
    }
    if (this.#parsedProposal !== null) throw new TypeError("Parsed proposal is already recorded");
    this.#parsedProposal = captureValue(value);
  }

  /** Closes a settled call only when its evidence agrees with the enclosing step. */
  public close(stepStatus: StepTerminalStatus, stepError: RunError | null): ModelCallRecord {
    if (this.#lifecycle.state === "closed") {
      throw new TypeError("Model call record is already closed");
    }
    this.assertStepClosure(stepStatus, stepError);
    const record: ModelCallRecord = {
      proposal_schema: this.#proposalSchema,
      model_name: this.#modelName,
      identity: this.#identity,
      payloads: {
        request: this.#request,
        raw_response: this.#rawResponse,
        parsed_json: this.#parsedJson,
        parsed_proposal: this.#parsedProposal,
      },
      usage: this.#usage,
      attempts: this.#attempts,
    };
    this.#lifecycle = {
      state: "closed",
      outcomeError: this.#lifecycle.outcomeError,
    };
    return record;
  }

  /** Rejects implicit interruption and outcome/step combinations that did not occur. */
  private assertStepClosure(stepStatus: StepTerminalStatus, stepError: RunError | null): void {
    if (this.#lifecycle.state === "open") {
      throw new TypeError("Open model call must settle or be interrupted explicitly");
    }
    this.assertProviderFailureClosure(stepStatus, stepError);
    this.assertCancellationClosure(stepStatus, stepError);
    this.assertProviderSuccessClosure(stepStatus);
  }

  /** Requires failed transport evidence and the enclosing step to share one error owner. */
  private assertProviderFailureClosure(
    stepStatus: StepTerminalStatus,
    stepError: RunError | null,
  ): void {
    if (
      this.#lifecycle.state !== "provider_failure" &&
      this.#lifecycle.state !== "invocation_failure"
    ) {
      return;
    }
    if (stepStatus !== "failure") {
      throw new TypeError("Failed provider outcome requires a failed step");
    }
    if (stepError !== this.#lifecycle.outcomeError) {
      throw new TypeError("Failed step requires the exact provider outcome error");
    }
  }

  /** Requires returned cancellation errors to remain authoritative for the step. */
  private assertCancellationClosure(
    stepStatus: StepTerminalStatus,
    stepError: RunError | null,
  ): void {
    if (this.#lifecycle.state !== "provider_cancelled" && this.#lifecycle.state !== "interrupted") {
      return;
    }
    if (stepStatus !== "cancelled") {
      throw new TypeError("Cancelled or interrupted model call requires a cancelled step");
    }
    if (
      this.#lifecycle.state === "provider_cancelled" &&
      stepError !== this.#lifecycle.outcomeError
    ) {
      throw new TypeError("Cancelled step requires the exact provider outcome error");
    }
  }

  /** Admits schema failure but requires a typed proposal for later successful work. */
  private assertProviderSuccessClosure(stepStatus: StepTerminalStatus): void {
    if (this.#lifecycle.state === "provider_success" && this.#parsedProposal === null) {
      if (stepStatus !== "failure") {
        throw new TypeError("Successful model step requires a recorded typed proposal");
      }
    }
  }
}
