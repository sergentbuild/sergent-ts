import type { Intent, Operation, RunError, Target } from "sergent-ts-core";
import { createRunRecordBuilder } from "sergent-ts-observability";
import type {
  CancellationCheckpoint,
  RunRecord,
  RunStage,
  SergentResult,
  StepRecordBuilder,
  StepName,
  TerminalFacts,
} from "sergent-ts-observability";

import type { RunDelivery } from "../delivery/index.js";
import type { BoundScene } from "../scene-authority/index.js";
import type { RuntimeConfiguration } from "./configuration.js";

/** Mutable owner that keeps Step Record construction, stages, and terminal delivery aligned. */
export class RunSession<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
> {
  readonly #recordBuilder;
  #currentStep: StepName | null = null;

  /** Opens Run Record construction after trustworthy Scene identity exists. */
  public constructor(
    public readonly configuration: RuntimeConfiguration<
      Proposal,
      IntentValue,
      Scene,
      TargetValue,
      OperationData
    >,
    public readonly binding: BoundScene<Scene>,
    public readonly signal: AbortSignal,
    public readonly delivery: RunDelivery<Scene>,
  ) {
    this.#recordBuilder = createRunRecordBuilder(delivery.current.run_id, configuration.modelName);
    this.#recordBuilder.bindScene(binding.identity);
  }

  /** Returns the open step for unexpected-exception correlation. */
  public get currentStep(): StepName | null {
    return this.#currentStep;
  }

  /** Emits one running progress stage with the run's base identity. */
  public reach(stage: RunStage): void {
    this.delivery.reached(this.binding.identity, stage);
  }

  /** Opens the builder for exactly the next reached Step Record. */
  public startStep(name: StepName): StepRecordBuilder {
    const step = this.#recordBuilder.startStep(name);
    this.#currentStep = name;
    return step;
  }

  /** Closes one active step successfully and clears exception correlation. */
  public succeedStep(step: StepRecordBuilder): void {
    step.succeed();
    this.#currentStep = null;
  }

  /** Closes expected failure with the unchanged run base Scene. */
  public fail(error: RunError): SergentResult<Scene> {
    const record = this.#recordBuilder.fail(error);
    this.#currentStep = null;
    return this.finish(this.binding.base, record);
  }

  /** Closes caller cancellation with the unchanged run base Scene. */
  public cancel(
    error: RunError<"cancelled">,
    checkpoint: CancellationCheckpoint,
  ): SergentResult<Scene> {
    const record = this.#recordBuilder.cancel(error, checkpoint);
    this.#currentStep = null;
    return this.finish(this.binding.base, record);
  }

  /** Closes successful stop or commit and delivers the final Scene. */
  public succeed(
    scene: Scene,
    revision: number,
    terminal: TerminalFacts | null = null,
  ): SergentResult<Scene> {
    const record = this.#recordBuilder.succeed(revision, terminal);
    this.#currentStep = null;
    return this.finish(scene, record);
  }

  /** Performs terminal progress and observer delivery for one closed Run Record. */
  private finish(scene: Scene, record: RunRecord): SergentResult<Scene> {
    return this.delivery.finish(scene, this.binding.identity, record, this.delivery.current.stage);
  }
}
