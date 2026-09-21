import type { RunError, RunId, SceneIdentity } from "sergent-ts-core";
import { createProgressSnapshot, createSergentResult } from "sergent-ts-observability";
import type {
  ProgressSnapshot,
  RunObserver,
  RunRecord,
  RunStage,
  SergentResult,
} from "sergent-ts-observability";

import type { RunHandle } from "./run-handle.js";
import { observerDeliveryError } from "../exception-evidence/index.js";

/** Mutable delivery owner for one run's progress and isolated observer errors. */
export class RunDelivery<Scene> {
  readonly #runId: RunId;
  readonly #observers: readonly RunObserver<Scene>[];
  readonly #errors: RunError<"observer_error">[] = [];
  #current: ProgressSnapshot;

  /** Opens delivery at the required queued snapshot. */
  public constructor(runId: RunId, observers: readonly RunObserver<Scene>[]) {
    this.#runId = runId;
    this.#observers = [...observers];
    this.#current = createProgressSnapshot(runId, null, "queued", "queued");
  }

  /** Returns the most recently delivered sanitized progress snapshot. */
  public get current(): ProgressSnapshot {
    return this.#current;
  }

  /** Delivers the initial queued progress before the execution pipeline. */
  public queued(): void {
    this.deliverProgress(this.#current);
  }

  /** Advances running progress to one reached stage. */
  public reached(scene: SceneIdentity, stage: RunStage): void {
    this.#current = createProgressSnapshot(this.#runId, scene, stage, "running");
    this.deliverProgress(this.#current);
  }

  /** Delivers terminal progress, then finished callbacks with accumulated errors. */
  public finish(
    scene: Scene,
    identity: SceneIdentity,
    record: RunRecord,
    stage: RunStage,
  ): SergentResult<Scene> {
    this.#current = createProgressSnapshot(this.#runId, identity, stage, record.outcome.status);
    this.deliverProgress(this.#current);
    let result = createSergentResult(scene, record, stage, this.#errors);
    for (const observer of this.#observers) {
      try {
        observer.finished(result);
      } catch (reason) {
        this.#errors.push(observerDeliveryError("finished", observer, reason, stage));
        result = createSergentResult(scene, record, stage, this.#errors);
      }
    }
    return result;
  }

  /** Delivers one progress value to every configured slot in order. */
  private deliverProgress(snapshot: ProgressSnapshot): void {
    for (const observer of this.#observers) {
      try {
        observer.progress(snapshot);
      } catch (reason) {
        this.#errors.push(observerDeliveryError("progress", observer, reason, snapshot.stage));
      }
    }
  }
}

/** Creates the mutable delivery owner for one run. */
export function createRunDelivery<Scene>(
  runId: RunId,
  observers: readonly RunObserver<Scene>[],
): RunDelivery<Scene> {
  return new RunDelivery(runId, observers);
}

/** Creates a stable handle whose progress getter follows its delivery owner. */
export function createRunHandle<Scene>(
  runId: RunId,
  delivery: RunDelivery<Scene>,
  result: Promise<SergentResult<Scene>>,
): RunHandle<Scene> {
  return {
    run_id: runId,
    get progress(): ProgressSnapshot {
      return delivery.current;
    },
    result,
  };
}
