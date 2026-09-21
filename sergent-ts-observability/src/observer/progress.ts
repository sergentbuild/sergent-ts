import type { RunId, SceneId, SceneIdentity } from "sergent-ts-core";

/** The complete ordered runtime stage vocabulary. */
export type RunStage =
  | "queued"
  | "started"
  | "intent_call"
  | "intent"
  | "plan_call"
  | "execution_plan"
  | "patch"
  | "dry_run"
  | "commit";

/** The small public progress status vocabulary. */
export type ProgressStatus = "queued" | "running" | "success" | "failure" | "cancelled";

/** The exact sanitized live progress view. */
export interface ProgressSnapshot {
  readonly run_id: RunId;
  readonly scene_id: SceneId | null;
  readonly stage: RunStage;
  readonly status: ProgressStatus;
  readonly revision: number;
}

/** Creates the exact five-field sanitized progress value. */
export function createProgressSnapshot(
  runId: RunId,
  scene: SceneIdentity | null,
  stage: RunStage,
  status: ProgressStatus,
): ProgressSnapshot {
  return {
    run_id: runId,
    scene_id: scene?.scene_id ?? null,
    stage,
    status,
    revision: scene?.revision ?? 0,
  };
}
