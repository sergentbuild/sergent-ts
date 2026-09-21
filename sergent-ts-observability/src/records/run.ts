import type {
  JsonObject,
  OperationId,
  RunError,
  RunId,
  SceneId,
  SceneIdentity,
} from "sergent-ts-core";

import type { CapturedValue, ModelCallRecord } from "./model.js";

/** The five ordered Step Record names. */
export type StepName = "process_input" | "intent" | "execution_plan" | "patch" | "commit";

/** A completed wall and monotonic span. */
export interface ClosedTimeSpan {
  readonly started_at: string;
  readonly finished_at: string;
  readonly duration_ms: number;
}

/** The Scene revision observed and the terminal revision fact. */
export interface SceneTransition {
  readonly scene_id: SceneId;
  readonly revision_before: number;
  readonly revision_after: number | null;
}

/** One successful Step Record. */
export interface SuccessfulStepRecord {
  readonly name: StepName;
  readonly status: "success";
  readonly timing: ClosedTimeSpan;
  readonly input: CapturedValue | null;
  readonly output: CapturedValue | null;
  readonly error: null;
  readonly model_call: ModelCallRecord | null;
}

/** One failed Step Record. */
export interface FailedStepRecord {
  readonly name: StepName;
  readonly status: "failure";
  readonly timing: ClosedTimeSpan;
  readonly input: CapturedValue | null;
  readonly output: CapturedValue | null;
  readonly error: RunError;
  readonly model_call: ModelCallRecord | null;
}

/** One cancelled Step Record. */
export interface CancelledStepRecord {
  readonly name: StepName;
  readonly status: "cancelled";
  readonly timing: ClosedTimeSpan;
  readonly input: CapturedValue | null;
  readonly output: CapturedValue | null;
  readonly error: RunError<"cancelled">;
  readonly model_call: ModelCallRecord | null;
}

/** One closed reached step in execution order. */
export type RunStepRecord = SuccessfulStepRecord | FailedStepRecord | CancelledStepRecord;

/** Independently captured terminal success facts. */
export interface TerminalRecord {
  readonly message: CapturedValue;
  readonly metadata: CapturedValue;
}

/** A successful terminal run outcome. */
export interface SuccessfulRunOutcome {
  readonly status: "success";
  readonly error: null;
  readonly terminal: TerminalRecord | null;
}

/** A failed terminal run outcome. */
export interface FailedRunOutcome {
  readonly status: "failure";
  readonly error: RunError;
  readonly terminal: null;
}

/** A cancelled terminal run outcome. */
export interface CancelledRunOutcome {
  readonly status: "cancelled";
  readonly error: RunError<"cancelled">;
  readonly terminal: null;
}

/** The checkpoint where a cancellation took effect. */
export type CancellationCheckpoint =
  | "before_intent"
  | "after_intent_validation"
  | "before_dry_run"
  | "before_commit"
  | "task_cancelled";

/** Cancellation timing and the reached runtime checkpoint. */
export interface CancellationRecord {
  readonly requested_at: string;
  readonly checkpoint: CancellationCheckpoint | null;
}

/** Fields common to every terminal RunRecord state. */
interface RunRecordBase {
  readonly run_id: RunId;
  readonly model_name: string;
  readonly timing: ClosedTimeSpan;
  readonly steps: readonly RunStepRecord[];
}

/** A closed successful run with a known terminal revision. */
export interface SuccessfulRunRecord extends RunRecordBase {
  readonly scene: SceneTransition & { readonly revision_after: number };
  readonly outcome: SuccessfulRunOutcome;
  readonly cancellation: null;
}

/** A closed failed run with no terminal revision. */
export interface FailedRunRecord extends RunRecordBase {
  readonly scene: SceneTransition & { readonly revision_after: null };
  readonly outcome: FailedRunOutcome;
  readonly cancellation: null;
}

/** A closed cancelled run with its cancellation evidence. */
export interface CancelledRunRecord extends RunRecordBase {
  readonly scene: SceneTransition & { readonly revision_after: null };
  readonly outcome: CancelledRunOutcome;
  readonly cancellation: CancellationRecord;
}

/** The authoritative inert evidence of one completed Run. */
export type RunRecord = SuccessfulRunRecord | FailedRunRecord | CancelledRunRecord;

/** One readonly Patch summary shared by the Run Record and conflict evidence. */
export interface PatchSummary {
  readonly base: SceneIdentity;
  readonly operation_count: number;
  readonly operation_ids: readonly OperationId[];
  readonly operation_call_names: readonly string[];
  readonly operation_trace_ids: readonly OperationId[];
  readonly operations: readonly CapturedValue[];
}

/** Commit authority selected for one successful Patch. */
export type CommitKind = "plain" | "exact" | "rebased";

/** Creates an isolated terminal cancellation record. */
export function createCancellationRecord(
  requestedAt: string,
  checkpoint: CancellationCheckpoint | null,
): CancellationRecord {
  return { requested_at: requestedAt, checkpoint };
}

/** Creates an isolated commit output value for step capture. */
export function commitEvidence(kind: CommitKind, metadata: JsonObject): JsonObject {
  return { commit_kind: kind, metadata: structuredClone(metadata) };
}
