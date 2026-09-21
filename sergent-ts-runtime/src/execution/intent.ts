import { cancelledError, createModelRequest } from "sergent-ts-core";
import type { Intent, Operation, RecipeContext, Target } from "sergent-ts-core";
import type { SergentResult } from "sergent-ts-observability";

import { invokeModelPhase } from "./model-call.js";
import type { RunSession } from "./session.js";

/** Continuing Intent and context, or a completed terminal run. */
export type IntentPhaseResult<Scene, IntentValue extends Intent, TargetValue extends Target> =
  | Readonly<{
      kind: "continue";
      intent: IntentValue;
      context: RecipeContext<Scene, TargetValue>;
    }>
  | Readonly<{ kind: "terminal"; result: SergentResult<Scene> }>;

/** Obtains one typed Intent proposal from deterministic or model-backed input. */
async function obtainProposal<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  session: RunSession<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  context: RecipeContext<Scene, TargetValue>,
  step: import("sergent-ts-observability").StepRecordBuilder,
): Promise<
  Readonly<{ ok: true; proposal: Proposal }> | Readonly<{ ok: false; result: SergentResult<Scene> }>
> {
  const source = session.configuration.intentSource;
  if (source.kind === "pass_through") {
    return { ok: true, proposal: source.proposal };
  }
  const messageContext = { ...context, proposalSchema: source.proposalSchema };
  const messages = session.configuration.intentPolicy.buildIntentMessages(messageContext);
  const request = createModelRequest(
    session.configuration.modelName,
    messages,
    source.proposalSchema,
    session.configuration.intentSettings,
  );
  session.reach("intent_call");
  const model = await invokeModelPhase(session, step, request, "before_intent");
  if (!model.ok) return model;
  const decoded = source.decode(model.outcome.parsedJson);
  if (!decoded.ok) return { ok: false, result: session.fail(decoded.error) };
  model.recordBuilder.recordParsedProposal(decoded.value);
  return { ok: true, proposal: decoded.value };
}

/** Derives, validates, and follows the exact Intent flow gate. */
export async function runIntentPhase<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  session: RunSession<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  context: RecipeContext<Scene, TargetValue>,
): Promise<IntentPhaseResult<Scene, IntentValue, TargetValue>> {
  const step = session.startStep("intent");
  const proposal = await obtainProposal(session, context, step);
  if (!proposal.ok) return { kind: "terminal", result: proposal.result };
  session.reach("intent");
  const intent = session.configuration.intentPolicy.deriveIntent(proposal.proposal, context);
  step.addOutput("derived_intent", intent);
  step.addOutput("flow", intent.flow);
  const validation = session.configuration.intentPolicy.validateIntent(intent, context);
  if (!validation.ok) {
    return { kind: "terminal", result: session.fail(validation.error) };
  }
  if (session.signal.aborted) {
    return {
      kind: "terminal",
      result: session.cancel(
        cancelledError("Run was cancelled after Intent validation"),
        "after_intent_validation",
      ),
    };
  }
  if (intent.flow === "stop") {
    const terminal = session.configuration.intentPolicy.stopTerminal(intent, context);
    session.succeedStep(step);
    return {
      kind: "terminal",
      result: session.succeed(session.binding.base, session.binding.identity.revision, {
        message: terminal.data,
        metadata: terminal.metadata,
      }),
    };
  }
  session.succeedStep(step);
  return { kind: "continue", intent, context };
}
