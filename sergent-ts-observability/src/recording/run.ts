import type { RunError, RunId, SceneIdentity } from "sergent-ts-core";

import { captureValue } from "../capture/index.js";
import type {
  CancellationCheckpoint,
  CancelledRunRecord,
  FailedRunRecord,
  RunRecord,
  RunStepRecord,
  StepName,
  SuccessfulRunRecord,
  TerminalRecord,
} from "../records/index.js";
import { createCancellationRecord } from "../records/index.js";
import { StepRecordBuilder } from "./step.js";
import type { RecordClock } from "./time.js";
import { formatTimestamp, SYSTEM_CLOCK, TimeSpanBuilder } from "./time.js";

/** The complete required step order. */
const STEP_ORDER: readonly StepName[] = [
  "process_input",
  "intent",
  "execution_plan",
  "patch",
  "commit",
];

/** Success facts captured independently before terminal presence is determined. */
export interface TerminalFacts {
  readonly message: unknown;
  readonly metadata: unknown;
}

/** A child terminal that constrains the only truthful run terminal action. */
type RequiredTerminal =
  | Readonly<{ status: "failure"; error: RunError }>
  | Readonly<{ status: "cancelled"; error: RunError<"cancelled"> }>;

/** Captures independent terminal fields without allowing one failure to erase the other. */
function terminalRecord(facts: TerminalFacts | null): TerminalRecord | null {
  if (facts === null) return null;
  const message = captureValue(facts.message);
  const metadata = captureValue(facts.metadata);
  if (
    message.error === null &&
    message.value === null &&
    metadata.error === null &&
    metadata.value !== null &&
    typeof metadata.value === "object" &&
    !Array.isArray(metadata.value) &&
    Object.keys(metadata.value).length === 0
  ) {
    return null;
  }
  return { message, metadata };
}

/** Builds one Run Record and appends each Step Record only after its closure. */
export class RunRecordBuilder {
  readonly #runId: RunId;
  readonly #modelName: string;
  readonly #clock: RecordClock;
  readonly #timing: TimeSpanBuilder;
  readonly #steps: RunStepRecord[] = [];
  #scene: SceneIdentity | null = null;
  #activeStep: StepRecordBuilder | null = null;
  #requiredTerminal: RequiredTerminal | null = null;
  #closed = false;

  /** Opens one run with stable identity and model selection. */
  public constructor(runId: RunId, modelName: string, clock: RecordClock = SYSTEM_CLOCK) {
    this.#runId = runId;
    this.#modelName = modelName;
    this.#clock = clock;
    this.#timing = new TimeSpanBuilder(clock);
  }

  /** Binds the Scene identity exactly once before run work proceeds. */
  public bindScene(identity: SceneIdentity): void {
    this.assertOpen();
    if (this.#scene !== null) throw new TypeError("Run Scene identity is already bound");
    this.#scene = { ...identity };
  }

  /** Opens a builder for exactly the next reached step. */
  public startStep(name: StepName): StepRecordBuilder {
    this.assertOpen();
    if (this.#activeStep !== null) throw new TypeError("A run step is already active");
    if (this.#requiredTerminal !== null) {
      throw new TypeError("A terminal child step prevents later run steps");
    }
    if (STEP_ORDER[this.#steps.length] !== name) {
      throw new TypeError(`Expected next run step ${STEP_ORDER[this.#steps.length] ?? "none"}`);
    }
    const step = new StepRecordBuilder(name, this.#clock, (owner, record) => {
      if (this.#activeStep !== owner) throw new TypeError("Closed step is not the active step");
      this.#steps.push(record);
      this.#activeStep = null;
      if (record.status === "failure") {
        this.#requiredTerminal = { status: record.status, error: record.error };
      } else if (record.status === "cancelled") {
        this.#requiredTerminal = { status: record.status, error: record.error };
      }
    });
    this.#activeStep = step;
    return step;
  }

  /** Closes a successful run with its known terminal revision. */
  public succeed(
    revisionAfter: number,
    terminal: TerminalFacts | null = null,
  ): SuccessfulRunRecord {
    const scene = this.boundScene();
    if (this.#requiredTerminal !== null) {
      throw new TypeError("A failed or cancelled step cannot close as success");
    }
    this.#activeStep?.succeed();
    if (this.#steps.some((step) => step.status !== "success")) {
      throw new TypeError("Successful runs require only successful steps");
    }
    this.assertSuccessShape(scene, revisionAfter);
    const record: SuccessfulRunRecord = {
      ...this.commonRecord(),
      scene: {
        scene_id: scene.scene_id,
        revision_before: scene.revision,
        revision_after: revisionAfter,
      },
      outcome: {
        status: "success",
        error: null,
        terminal: terminalRecord(terminal),
      },
      cancellation: null,
    };
    this.#closed = true;
    return record;
  }

  /** Closes a failed run and attributes the error to any open step. */
  public fail(error: RunError): FailedRunRecord {
    const scene = this.boundScene();
    this.assertTerminalAction("failure", error);
    this.#activeStep?.fail(error);
    const record: FailedRunRecord = {
      ...this.commonRecord(),
      scene: {
        scene_id: scene.scene_id,
        revision_before: scene.revision,
        revision_after: null,
      },
      outcome: { status: "failure", error, terminal: null },
      cancellation: null,
    };
    this.#closed = true;
    return record;
  }

  /** Closes a cancelled run and records where cancellation took effect. */
  public cancel(
    error: RunError<"cancelled">,
    checkpoint: CancellationCheckpoint | null,
  ): CancelledRunRecord {
    const scene = this.boundScene();
    this.assertTerminalAction("cancelled", error);
    const requestedAt = formatTimestamp(this.#clock.wallNow());
    this.#activeStep?.cancel(error);
    const record: CancelledRunRecord = {
      ...this.commonRecord(),
      scene: {
        scene_id: scene.scene_id,
        revision_before: scene.revision,
        revision_after: null,
      },
      outcome: { status: "cancelled", error, terminal: null },
      cancellation: createCancellationRecord(requestedAt, checkpoint),
    };
    this.#closed = true;
    return record;
  }

  /** Rejects mutation after terminal closure. */
  private assertOpen(): void {
    if (this.#closed) throw new TypeError("Run Record builder is already closed");
  }

  /** Enforces the terminal implied by a child and rejects post-commit reversal. */
  private assertTerminalAction(status: "failure" | "cancelled", error: RunError): void {
    if (
      this.#activeStep === null &&
      this.#steps.length === STEP_ORDER.length &&
      this.#requiredTerminal === null
    ) {
      throw new TypeError("A completed commit cannot fail or cancel");
    }
    const required = this.#requiredTerminal;
    if (required === null) return;
    if (required.status !== status || required.error !== error) {
      throw new TypeError(`Run must close as ${required.status} with its child error`);
    }
  }

  /** Returns the bound Scene identity required for terminal construction. */
  private boundScene(): SceneIdentity {
    this.assertOpen();
    if (this.#scene === null) throw new TypeError("Run Scene identity is not bound");
    return this.#scene;
  }

  /** Admits only stop-Intent or committed successful run shapes. */
  private assertSuccessShape(scene: SceneIdentity, revisionAfter: number): void {
    if (this.#steps.length !== 2 && this.#steps.length !== STEP_ORDER.length) {
      throw new TypeError("Successful run must close at Intent or Commit");
    }
    if (this.#steps.length === 2 && revisionAfter !== scene.revision) {
      throw new TypeError("Stop Intent success must preserve the observed revision");
    }
  }

  /** Closes common run timing and isolates the ordered step list. */
  private commonRecord(): Pick<RunRecord, "run_id" | "model_name" | "timing" | "steps"> {
    return {
      run_id: this.#runId,
      model_name: this.#modelName,
      timing: this.#timing.close(),
      steps: [...this.#steps],
    };
  }
}

/** Opens one Run Record builder with an optional deterministic clock seam. */
export function createRunRecordBuilder(
  runId: RunId,
  modelName: string,
  clock: RecordClock = SYSTEM_CLOCK,
): RunRecordBuilder {
  return new RunRecordBuilder(runId, modelName, clock);
}
