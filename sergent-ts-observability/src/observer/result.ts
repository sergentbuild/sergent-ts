import type { JsonObject, RunError } from "sergent-ts-core";

import type {
  CancelledRunRecord,
  FailedRunRecord,
  RunRecord,
  SuccessfulRunRecord,
} from "../records/index.js";
import type { ProgressSnapshot, RunStage } from "./progress.js";

/** Fields shared by every terminal in-process result. */
interface SergentResultBase<Scene> {
  readonly scene: Scene;
  readonly stage: RunStage;
  readonly observer_errors: readonly RunError<"observer_error">[];
}

/** A successful in-process result and its convenience terminal facts. */
export interface SuccessfulSergentResult<Scene> extends SergentResultBase<Scene> {
  readonly run_record: SuccessfulRunRecord;
  readonly terminal_message: string | null;
  readonly terminal_metadata: JsonObject;
}

/** A failed in-process result and its error convenience facts. */
export interface FailedSergentResult<Scene> extends SergentResultBase<Scene> {
  readonly run_record: FailedRunRecord;
  readonly terminal_message: string;
  readonly terminal_metadata: JsonObject;
}

/** A cancelled in-process result and its error convenience facts. */
export interface CancelledSergentResult<Scene> extends SergentResultBase<Scene> {
  readonly run_record: CancelledRunRecord;
  readonly terminal_message: string;
  readonly terminal_metadata: JsonObject;
}

/** The immutable terminal in-process return from one run. */
export type SergentResult<Scene = unknown> =
  | SuccessfulSergentResult<Scene>
  | FailedSergentResult<Scene>
  | CancelledSergentResult<Scene>;

/** A synchronous non-controlling run observer. */
export interface RunObserver<Scene = unknown> {
  /** Receives one immutable sanitized progress snapshot. */
  progress(snapshot: ProgressSnapshot): undefined;

  /** Receives one immutable terminal in-process result. */
  finished(result: SergentResult<Scene>): undefined;
}

/** Reads captured terminal prose when its projection succeeded. */
function terminalMessage(record: SuccessfulRunRecord): string | null {
  const captured = record.outcome.terminal?.message;
  return captured?.status === "captured" && typeof captured.value === "string"
    ? captured.value
    : null;
}

/** Reads captured terminal metadata when its projection stayed an object. */
function terminalMetadata(record: SuccessfulRunRecord): JsonObject {
  const captured = record.outcome.terminal?.metadata;
  if (captured?.status !== "captured") return {};
  const value = captured.value;
  return isJsonObject(value) ? value : {};
}

/** Narrows one projected JSON value to a non-array object. */
function isJsonObject(value: import("sergent-ts-core").JsonValue | null): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Narrows a closed Run Record by its terminal outcome. */
function isSuccessfulRecord(record: RunRecord): record is SuccessfulRunRecord {
  return record.outcome.status === "success";
}

/** Narrows a closed Run Record to expected failure. */
function isFailedRecord(record: RunRecord): record is FailedRunRecord {
  return record.outcome.status === "failure";
}

/** Constructs a readonly result whose convenience facts follow its Run Record outcome. */
export function createSergentResult<Scene>(
  scene: Scene,
  runRecord: RunRecord,
  stage: RunStage,
  observerErrors: readonly RunError<"observer_error">[] = [],
): SergentResult<Scene> {
  const common = {
    scene,
    stage,
    observer_errors: [...observerErrors],
  };
  if (isSuccessfulRecord(runRecord)) {
    return {
      ...common,
      run_record: runRecord,
      terminal_message: terminalMessage(runRecord),
      terminal_metadata: terminalMetadata(runRecord),
    };
  }
  if (isFailedRecord(runRecord)) {
    return {
      ...common,
      run_record: runRecord,
      terminal_message: runRecord.outcome.error.message,
      terminal_metadata: runRecord.outcome.error.metadata,
    };
  }
  return {
    ...common,
    run_record: runRecord,
    terminal_message: runRecord.outcome.error.message,
    terminal_metadata: runRecord.outcome.error.metadata,
  };
}
