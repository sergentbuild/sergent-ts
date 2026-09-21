import type { RunId } from "sergent-ts-core";
import type { ProgressSnapshot, SergentResult } from "sergent-ts-observability";

/** A started run with live sanitized progress and one owned result Promise. */
export interface RunHandle<Scene> {
  readonly run_id: RunId;
  readonly progress: ProgressSnapshot;
  readonly result: Promise<SergentResult<Scene>>;
}
