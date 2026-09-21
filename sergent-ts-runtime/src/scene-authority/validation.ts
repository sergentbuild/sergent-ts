import { patchValidationError, validationError } from "sergent-ts-core";
import type {
  ExecutionPlan,
  Intent,
  Operation,
  OperationRegistry,
  Patch,
  PlanStep,
  RunError,
  SceneActions,
  SceneIdentity,
  Target,
} from "sergent-ts-core";

import { isolatePlanStep } from "./patch-isolation.js";

/** Accepted or rejected deterministic runtime validation. */
export type ValidationResult<Value = undefined> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; error: RunError }>;

/** Complete inputs for validating one application-supplied rebase replacement. */
export interface RebasedPatchValidationRequest<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
> {
  readonly original: Patch<OperationData>;
  readonly replacement: Patch<OperationData>;
  readonly current: Scene;
  readonly currentIdentity: SceneIdentity;
  readonly target: TargetValue;
  readonly registry: OperationRegistry<OperationData, Scene, IntentValue, TargetValue>;
  readonly actions: SceneActions<Scene, TargetValue, IntentValue, OperationData>;
}

/** Compares the two authoritative fields of a Scene identity. */
function identitiesEqual(left: SceneIdentity, right: SceneIdentity): boolean {
  return left.scene_id === right.scene_id && left.revision === right.revision;
}

/** Checks nonempty Patch identity and stable Plan script identity. */
function validateScriptIdentity<IntentValue extends Intent, OperationData extends Operation>(
  plan: ExecutionPlan<IntentValue, OperationData>,
  patch: Patch<OperationData>,
  expectedBase: SceneIdentity,
): RunError | null {
  if (patch.steps.length === 0) return patchValidationError("Patch must be nonempty");
  if (!identitiesEqual(plan.base, expectedBase)) {
    return patchValidationError("ExecutionPlan base does not match the run base");
  }
  if (!identitiesEqual(plan.base, patch.base)) {
    return patchValidationError("Patch base does not match the ExecutionPlan base");
  }
  if (patch.steps.length !== plan.steps.length) {
    return patchValidationError("Patch must preserve every planned Operation");
  }
  for (const [index, step] of patch.steps.entries()) {
    const planned = plan.steps[index];
    if (planned?.op_id !== step.op_id || planned.operation.call !== step.operation.call) {
      return patchValidationError("Patch must preserve Operation calls and identities");
    }
  }
  return null;
}

/** Validates the ordinary compiled Patch and original bounded Target. */
export function validateOriginalPatch<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  plan: ExecutionPlan<IntentValue, OperationData>,
  patch: Patch<OperationData>,
  baseIdentity: SceneIdentity,
  scene: Scene,
  target: TargetValue,
  actions: SceneActions<Scene, TargetValue, IntentValue, OperationData>,
): ValidationResult {
  const identityError = validateScriptIdentity(plan, patch, baseIdentity);
  if (identityError !== null) return { ok: false, error: identityError };
  if (!actions.targetExists(scene, target)) {
    return {
      ok: false,
      error: patchValidationError("The selected Target no longer exists in the base Scene"),
    };
  }
  return { ok: true, value: undefined };
}

/** Projects the first application admissibility issue with framework identity. */
export function checkAdmissibility<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  scene: Scene,
  intent: IntentValue,
  target: TargetValue,
  steps: readonly PlanStep<OperationData>[],
  registry: OperationRegistry<OperationData, Scene, IntentValue, TargetValue>,
  actions: SceneActions<Scene, TargetValue, IntentValue, OperationData>,
): ValidationResult {
  for (const [index, step] of steps.entries()) {
    const context = { scene: actions.clone(scene), intent, target };
    const result = registry.checkAdmissibility(isolatePlanStep(step), context);
    if (!result.ok) {
      return {
        ok: false,
        error: validationError(result.issue.message, {
          index,
          call: step.operation.call,
          operation_id: step.op_id,
        }),
      };
    }
  }
  return { ok: true, value: undefined };
}

/** Admits rebase operands through original definitions and preserves script identity. */
export function validateRebasedPatch<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  request: RebasedPatchValidationRequest<Scene, TargetValue, IntentValue, OperationData>,
): ValidationResult<Patch<OperationData>> {
  if (!identitiesEqual(request.replacement.base, request.currentIdentity)) {
    return {
      ok: false,
      error: patchValidationError("Rebased Patch has stale base"),
    };
  }
  if (
    request.replacement.steps.length !== request.original.steps.length ||
    request.replacement.steps.length === 0
  ) {
    return {
      ok: false,
      error: patchValidationError("Rebase must preserve the complete Operation script"),
    };
  }
  const steps: PlanStep<OperationData>[] = [];
  for (const [index, replacementStep] of request.replacement.steps.entries()) {
    const originalStep = request.original.steps[index];
    if (
      originalStep === undefined ||
      replacementStep.op_id !== originalStep.op_id ||
      replacementStep.operation.call !== originalStep.operation.call
    ) {
      return {
        ok: false,
        error: patchValidationError("Rebase must preserve Operation calls and identities"),
      };
    }
    const decoded = request.registry.decodeOperation(
      originalStep.operation.call,
      replacementStep.operation,
    );
    if (!decoded.ok) return { ok: false, error: decoded.error };
    const admitted = structuredClone(decoded.value);
    steps.push({ op_id: originalStep.op_id, operation: admitted });
  }
  if (!request.actions.targetExists(request.current, request.target)) {
    return { ok: false, error: patchValidationError("Rebase Target is absent") };
  }
  return {
    ok: true,
    value: { base: request.currentIdentity, steps },
  };
}
