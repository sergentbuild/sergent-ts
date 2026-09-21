import type { ModelRequest, RunError } from "sergent-ts-core";

import { captureValue } from "../capture/index.js";
import type {
  CapturedValue,
  ClosedTimeSpan,
  ModelCallRecord,
  RunStepRecord,
  StepName,
} from "../records/index.js";
import { ModelCallRecordBuilder } from "./model-call.js";
import type { RecordClock } from "./time.js";
import { TimeSpanBuilder } from "./time.js";

/** Callback that transfers one closed child record to its run owner. */
type StepClosed = (owner: StepRecordBuilder, record: RunStepRecord) => void;

/** Terminal status of one reached step. */
type StepTerminalStatus = "success" | "failure" | "cancelled";

/** Narrows one open-kind run error to the cancellation outcome vocabulary. */
function isCancellationError(error: RunError): error is RunError<"cancelled"> {
  return error.kind === "cancelled";
}

/** Mutable owner for one reached step and its recaptured merged evidence. */
export class StepRecordBuilder {
  readonly #name: StepName;
  readonly #timing: TimeSpanBuilder;
  readonly #onClosed: StepClosed;
  #input: CapturedValue | null = null;
  readonly #rawOutput: Record<string, unknown> = {};
  #output: CapturedValue | null = null;
  #modelCall: ModelCallRecordBuilder | null = null;
  #closed = false;

  /** Opens one reached step owned by its parent run. */
  public constructor(name: StepName, clock: RecordClock, onClosed: StepClosed) {
    this.#name = name;
    this.#timing = new TimeSpanBuilder(clock);
    this.#onClosed = onClosed;
  }

  /** Captures the process-input evidence once. */
  public captureInput(value: unknown): void {
    this.assertOpen();
    if (this.#name !== "process_input") {
      throw new TypeError("Only process_input carries step input evidence");
    }
    if (this.#input !== null) throw new TypeError("Step input is already captured");
    this.#input = captureValue(value);
  }

  /** Adds or replaces one reached fact and recaptures the complete merged output. */
  public addOutput(name: string, value: unknown): void {
    this.assertOpen();
    this.#rawOutput[name] = value;
    this.#output = captureValue(this.#rawOutput);
  }

  /** Opens the only model call allowed on this step. */
  public openModelCall(request: ModelRequest): ModelCallRecordBuilder {
    this.assertOpen();
    if (this.#name !== "intent" && this.#name !== "execution_plan") {
      throw new TypeError("Only Intent and ExecutionPlan steps carry model calls");
    }
    if (this.#modelCall !== null) throw new TypeError("Step model call is already open");
    this.#modelCall = new ModelCallRecordBuilder(request);
    return this.#modelCall;
  }

  /** Closes the step successfully. */
  public succeed(): void {
    this.close("success", null);
  }

  /** Closes the step at its expected failure. */
  public fail(error: RunError): void {
    this.close("failure", error);
  }

  /** Closes the step at caller cancellation. */
  public cancel(error: RunError<"cancelled">): void {
    this.close("cancelled", error);
  }

  /** Rejects evidence mutation after the step has closed. */
  private assertOpen(): void {
    if (this.#closed) throw new TypeError("Step is already closed");
  }

  /** Builds one state-safe record and transfers it to the parent. */
  private close(status: StepTerminalStatus, error: RunError | null): void {
    this.assertOpen();
    this.assertClosure(status, error);
    const modelCall = this.#modelCall?.close(status, error) ?? null;
    const timing = this.#timing.close();
    const record = this.closedRecord(status, error, timing, modelCall);
    this.#closed = true;
    this.#onClosed(this, record);
  }

  /** Validates closure without mutating timing or child-call state. */
  private assertClosure(status: StepTerminalStatus, error: RunError | null): void {
    if (status === "success" && this.#name === "execution_plan" && this.#modelCall === null) {
      throw new TypeError("Successful ExecutionPlan step requires a model call");
    }
    if (status !== "success" && error === null) {
      throw new TypeError("Terminal step failure requires an error");
    }
    if (status === "cancelled" && error !== null && !isCancellationError(error)) {
      throw new TypeError("Cancelled step requires cancellation");
    }
  }

  /** Creates the exact state-safe record after all lifecycle checks pass. */
  private closedRecord(
    status: StepTerminalStatus,
    error: RunError | null,
    timing: ClosedTimeSpan,
    modelCall: ModelCallRecord | null,
  ): RunStepRecord {
    const common = {
      name: this.#name,
      timing,
      input: this.#input,
      output: this.#output,
      model_call: modelCall,
    };
    if (status === "success") {
      return { ...common, status, error: null };
    }
    if (error === null) throw new TypeError("Terminal step failure requires an error");
    if (status === "failure") return { ...common, status, error };
    if (!isCancellationError(error)) throw new TypeError("Cancelled step requires cancellation");
    return { ...common, status, error };
  }
}
