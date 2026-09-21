import type { Operation, Patch, PlanStep } from "sergent-ts-core";

/** Copies one Patch before it crosses an application-owned execution seam. */
export function isolatePatch<OperationData extends Operation>(
  patch: Patch<OperationData>,
): Patch<OperationData> {
  const isolated = structuredClone(patch);
  const steps = isolated.steps.map((step) => ({
    op_id: step.op_id,
    operation: step.operation,
  }));
  return {
    base: { ...isolated.base },
    steps,
  };
}

/** Copies one admitted step before a registry callback can observe it. */
export function isolatePlanStep<OperationData extends Operation>(
  step: PlanStep<OperationData>,
): PlanStep<OperationData> {
  const isolated = structuredClone(step);
  return { op_id: isolated.op_id, operation: isolated.operation };
}
