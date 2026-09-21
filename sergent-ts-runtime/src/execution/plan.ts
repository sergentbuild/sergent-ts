import { createModelRequest } from "sergent-ts-core";
import type { ExecutionPlan, Intent, Operation, RecipeContext, Target } from "sergent-ts-core";
import { executionPlanEvidence } from "sergent-ts-observability";
import type { SergentResult } from "sergent-ts-observability";

import { checkAdmissibility } from "../scene-authority/index.js";
import { invokeModelPhase } from "./model-call.js";
import type { RunSession } from "./session.js";

/** Validated ExecutionPlan or a terminal failed/cancelled run. */
export type PlanPhaseResult<Scene, IntentValue extends Intent, OperationData extends Operation> =
  | Readonly<{ ok: true; plan: ExecutionPlan<IntentValue, OperationData> }>
  | Readonly<{ ok: false; result: SergentResult<Scene> }>;

/** Runs the model-backed Plan crossing and all deterministic Plan validation. */
export async function runPlanPhase<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  session: RunSession<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  intent: IntentValue,
  context: RecipeContext<Scene, TargetValue>,
): Promise<PlanPhaseResult<Scene, IntentValue, OperationData>> {
  const policy = session.configuration.planPolicy;
  if (policy === null) throw new TypeError("Continuing Intent requires a captured registry");
  const step = session.startStep("execution_plan");
  const messageContext = { ...context, proposalSchema: policy.proposalSchema };
  const messages = policy.buildPlanMessages(intent, messageContext);
  const request = createModelRequest(
    session.configuration.modelName,
    messages,
    policy.proposalSchema,
    session.configuration.planSettings,
  );
  session.reach("plan_call");
  const model = await invokeModelPhase(session, step, request);
  if (!model.ok) return model;
  const decoded = policy.registry.decodePlan(model.outcome.parsedJson);
  if (!decoded.ok) return { ok: false, result: session.fail(decoded.error) };
  const typedProposal = {
    operations: decoded.steps.map((decodedStep) => decodedStep.operation),
  };
  model.recordBuilder.recordParsedProposal(typedProposal);
  session.reach("execution_plan");
  const plan = policy.derivePlan(session.binding.identity, intent, decoded.steps, context);
  step.addOutput("derived_execution_plan", executionPlanEvidence(plan));
  const admissibility = checkAdmissibility(
    session.binding.base,
    intent,
    context.target,
    plan.steps,
    policy.registry,
    session.configuration.actions,
  );
  if (!admissibility.ok) {
    return { ok: false, result: session.fail(admissibility.error) };
  }
  const validation = policy.validatePlan(plan, context);
  if (!validation.ok) return { ok: false, result: session.fail(validation.error) };
  session.succeedStep(step);
  return { ok: true, plan };
}
