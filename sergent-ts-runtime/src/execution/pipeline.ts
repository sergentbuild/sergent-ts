import type { Intent, MindBuf, Operation, RecipeContext, Target } from "sergent-ts-core";
import type { SergentResult } from "sergent-ts-observability";

import type { RunDelivery } from "../delivery/index.js";
import { runtimeInternalError } from "../exception-evidence/index.js";
import { bindSceneInput, SharedSceneAuthority } from "../scene-authority/index.js";
import type { RuntimeConfiguration } from "./configuration.js";
import { runIntentPhase } from "./intent.js";
import { runPatchPhase } from "./patch.js";
import { runPlanPhase } from "./plan.js";
import { RunSession } from "./session.js";

/** Captures process input and selects the one exact Target for the run. */
function prepareContext<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  session: RunSession<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  mindBuf: MindBuf,
): RecipeContext<Scene, TargetValue> | SergentResult<Scene> {
  const step = session.startStep("process_input");
  const rendered = mindBuf.export();
  step.captureInput({ observation: rendered });
  const target = session.configuration.actions.selectTarget(session.binding.base);
  step.addOutput("selected_target", target);
  if (target === null) return session.fail(session.configuration.intentPolicy.noTargetError);
  session.succeedStep(step);
  return { scene: session.binding.base, target, mindBuf: rendered };
}

/** Returns true when process preparation already produced a terminal result. */
function isTerminalPreparation<Scene, TargetValue extends Target>(
  value: RecipeContext<Scene, TargetValue> | SergentResult<Scene>,
): value is SergentResult<Scene> {
  return "run_record" in value;
}

/** Contains one ordinary post-binding exception when the Run Record can still close. */
function containFailure<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  session: RunSession<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  reason: unknown,
): SergentResult<Scene> {
  const error = runtimeInternalError(reason, session.currentStep);
  try {
    return session.fail(error);
  } catch {
    throw reason;
  }
}

/** Executes one bound run from process input through its terminal result. */
async function executeBound<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  session: RunSession<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  mindBuf: MindBuf,
): Promise<SergentResult<Scene>> {
  try {
    session.reach("started");
    const prepared = prepareContext(session, mindBuf);
    if (isTerminalPreparation(prepared)) return prepared;
    const intent = await runIntentPhase(session, prepared);
    if (intent.kind === "terminal") return intent.result;
    const plan = await runPlanPhase(session, intent.intent, intent.context);
    if (!plan.ok) return plan.result;
    return runPatchPhase(session, plan.plan, intent.context.target);
  } catch (reason) {
    return containFailure(session, reason);
  }
}

/** Binds trustworthy Scene identity, then runs the complete execution pipeline. */
export async function executePipeline<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  configuration: RuntimeConfiguration<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  input: Scene | SharedSceneAuthority<Scene>,
  mindBuf: MindBuf,
  signal: AbortSignal,
  delivery: RunDelivery<Scene>,
): Promise<SergentResult<Scene>> {
  const binding = bindSceneInput(input, configuration.actions);
  const session = new RunSession(configuration, binding, signal, delivery);
  return executeBound(session, mindBuf);
}
