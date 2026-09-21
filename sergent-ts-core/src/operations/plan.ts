import type { Intent, SceneIdentity } from "../values/index.js";
import type { ExecutionPlan, Patch, PlanStep } from "./types.js";

/** Derives an ExecutionPlan from decoded steps for subsequent semantic validation. */
export function createExecutionPlan<IntentValue extends Intent, OperationData>(
  base: SceneIdentity,
  intent: IntentValue,
  steps: readonly PlanStep<OperationData>[],
): ExecutionPlan<IntentValue, OperationData> {
  return { base, intent, steps: [...steps] };
}

/** Compiles the ordinary Patch as an isolated ordered copy of the validated Plan steps. */
export function compilePatch<IntentValue extends Intent, OperationData>(
  plan: ExecutionPlan<IntentValue, OperationData>,
): Patch<OperationData> {
  const steps = plan.steps.map((step) => structuredClone(step));
  return { base: plan.base, steps };
}
