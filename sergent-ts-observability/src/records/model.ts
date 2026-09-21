import type { JsonObject, JsonValue, RunError } from "sergent-ts-core";

/** One projected value retained in the Run Record. */
export type CapturedValue =
  | Readonly<{
      value: JsonValue;
      value_type: string;
      error: null;
      status: "captured";
    }>
  | Readonly<{
      value: null;
      value_type: string;
      error: RunError<"capture_error">;
      status: "capture_error";
    }>;

/** The canonical proposal schema retained beside one model call. */
export interface ProposalSchemaRecord {
  readonly name: string;
  readonly json_schema: JsonObject;
}

/** The provider endpoint resolved for one model call. */
export interface ModelIdentityRecord {
  readonly provider: string;
  readonly model: string;
  readonly sdk_package: string | null;
  readonly sdk_version: string | null;
}

/** Whole-call usage facts retained only when the provider reported them. */
export interface ModelUsageRecord {
  readonly latency_ms: number;
  readonly tokens: Readonly<Record<string, number>> | null;
  readonly request_id: string | null;
}

/** A successful completed provider attempt. */
export interface SuccessfulModelAttemptRecord {
  readonly timing: import("./run.js").ClosedTimeSpan;
  readonly status: "success";
  readonly retryable: null;
  readonly error: null;
}

/** A failed completed provider attempt. */
export interface FailedModelAttemptRecord {
  readonly timing: import("./run.js").ClosedTimeSpan;
  readonly status: "failure";
  readonly retryable: boolean;
  readonly error: RunError;
}

/** One completed provider attempt in execution order. */
export type ModelAttemptRecord = SuccessfulModelAttemptRecord | FailedModelAttemptRecord;

/** Request and reached response evidence for one model call. */
export interface ModelCallPayloads {
  readonly request: CapturedValue;
  readonly raw_response: string | null;
  readonly parsed_json: JsonObject | null;
  readonly parsed_proposal: CapturedValue | null;
}

/** The complete reached evidence for one model-backed step. */
export interface ModelCallRecord {
  readonly proposal_schema: ProposalSchemaRecord;
  readonly model_name: string;
  readonly identity: ModelIdentityRecord | null;
  readonly payloads: ModelCallPayloads;
  readonly usage: ModelUsageRecord | null;
  readonly attempts: readonly ModelAttemptRecord[];
}
