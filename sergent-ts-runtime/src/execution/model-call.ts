import { cancelledError } from "sergent-ts-core";
import type { ModelOutcome, ModelRequest, ModelSuccess } from "sergent-ts-core";
import type {
  ModelCallRecordBuilder,
  SergentResult,
  StepRecordBuilder,
} from "sergent-ts-observability";

import type { RunSession } from "./session.js";
import { runtimeInternalError } from "../exception-evidence/index.js";
import type { Intent, Operation, Target } from "sergent-ts-core";

/** Model await result distinguishes returned evidence from runtime interruption. */
type ModelAwaitResult =
  | Readonly<{ kind: "outcome"; outcome: ModelOutcome }>
  | Readonly<{ kind: "invocation_failure"; reason: unknown }>
  | Readonly<{ kind: "interrupted" }>;

/** Unique runtime interruption value raced directly against the adapter Promise. */
const INTERRUPTED = Symbol("runtime model interruption");

/** Defers fallback through the SDK-rejection and adapter-mapping reactions. */
function deferInterruption(resolve: (value: typeof INTERRUPTED) => void): void {
  queueMicrotask(() => {
    queueMicrotask(() => resolve(INTERRUPTED));
  });
}

/** Successful model evidence or a terminal run result. */
export type ModelPhaseResult<Scene> =
  | Readonly<{ ok: true; outcome: ModelSuccess; recordBuilder: ModelCallRecordBuilder }>
  | Readonly<{ ok: false; result: SergentResult<Scene> }>;

/** Races one invoked model Promise with the caller's AbortSignal. */
async function awaitModel(
  invoke: (request: ModelRequest, signal: AbortSignal) => Promise<ModelOutcome>,
  request: ModelRequest,
  signal: AbortSignal,
): Promise<ModelAwaitResult> {
  let invocation: Promise<ModelOutcome>;
  try {
    invocation = invoke(request, signal);
  } catch (reason) {
    return { kind: "invocation_failure", reason };
  }
  let interrupt: (() => void) | null = null;
  const cancellation = new Promise<typeof INTERRUPTED>((resolve) => {
    interrupt = (): void => deferInterruption(resolve);
    if (signal.aborted) interrupt();
    else signal.addEventListener("abort", interrupt, { once: true });
  });
  try {
    const settled = await Promise.race([invocation, cancellation]);
    return settled === INTERRUPTED
      ? { kind: "interrupted" }
      : { kind: "outcome", outcome: settled };
  } catch (reason) {
    return { kind: "invocation_failure", reason };
  } finally {
    if (interrupt !== null) signal.removeEventListener("abort", interrupt);
  }
}

/** Invokes one model call and closes all expected non-success outcomes. */
export async function invokeModelPhase<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  session: RunSession<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  step: StepRecordBuilder,
  request: ModelRequest,
  beforeInvokeCheckpoint: "before_intent" | null = null,
): Promise<ModelPhaseResult<Scene>> {
  const recordBuilder = step.openModelCall(request);
  if (beforeInvokeCheckpoint !== null && session.signal.aborted) {
    recordBuilder.interrupt();
    return {
      ok: false,
      result: session.cancel(
        cancelledError("Run was cancelled before Intent"),
        beforeInvokeCheckpoint,
      ),
    };
  }
  const awaited = await awaitModel(
    (modelRequest, signal) => session.configuration.invokeModel(modelRequest, signal),
    request,
    session.signal,
  );
  if (awaited.kind === "interrupted") {
    recordBuilder.interrupt();
    return {
      ok: false,
      result: session.cancel(cancelledError("Model invocation was cancelled"), "task_cancelled"),
    };
  }
  if (awaited.kind === "invocation_failure") {
    const error = runtimeInternalError(awaited.reason, session.currentStep);
    recordBuilder.failInvocation(error);
    return { ok: false, result: session.fail(error) };
  }
  recordBuilder.complete(awaited.outcome);
  if (awaited.outcome.status === "failure") {
    return { ok: false, result: session.fail(awaited.outcome.error) };
  }
  if (awaited.outcome.status === "cancelled") {
    return {
      ok: false,
      result: session.cancel(awaited.outcome.error, "task_cancelled"),
    };
  }
  return { ok: true, outcome: awaited.outcome, recordBuilder };
}
