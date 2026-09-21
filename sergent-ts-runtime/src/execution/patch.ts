import { cancelledError } from "sergent-ts-core";
import type { ExecutionPlan, Intent, Operation, Target } from "sergent-ts-core";
import { commitEvidence, projectPatchSummary } from "sergent-ts-observability";
import type { SergentResult, TerminalFacts } from "sergent-ts-observability";

import {
  commitRehearsedPatch,
  isolatePatch,
  rehearsePatch,
  validateOriginalPatch,
} from "../scene-authority/index.js";
import type { RunSession } from "./session.js";

/** Returns terminal rebase facts only when application metadata is nonempty. */
function commitTerminal(metadata: import("sergent-ts-core").JsonObject): TerminalFacts | null {
  return Object.keys(metadata).length === 0 ? null : { message: null, metadata };
}

/** Compiles, validates, rehearses, and commits one validated ExecutionPlan. */
export function runPatchPhase<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  session: RunSession<Proposal, IntentValue, Scene, TargetValue, OperationData>,
  plan: ExecutionPlan<IntentValue, OperationData>,
  target: TargetValue,
): SergentResult<Scene> {
  const policy = session.configuration.planPolicy;
  if (policy === null) throw new TypeError("Patch execution requires a captured registry");
  const step = session.startStep("patch");
  session.reach("patch");
  const patch = isolatePatch(policy.compilePatch(plan));
  const patchSummary = projectPatchSummary(patch);
  step.addOutput("compiled_patch", patchSummary);
  const validation = validateOriginalPatch(
    plan,
    patch,
    session.binding.identity,
    session.binding.base,
    target,
    session.configuration.actions,
  );
  if (!validation.ok) {
    step.addOutput("patch_validation", { status: "failure" });
    return session.fail(validation.error);
  }
  if (session.signal.aborted) {
    return session.cancel(cancelledError("Run was cancelled before dry-run"), "before_dry_run");
  }
  session.reach("dry_run");
  const rehearsal = rehearsePatch({
    before: session.binding.base,
    beforeIdentity: session.binding.embeddedIdentity,
    patch,
    intent: plan.intent,
    target,
    actions: session.configuration.actions,
    embeddedIdentityDelta: session.configuration.embeddedIdentityDelta,
  });
  if (!rehearsal.ok) return session.fail(rehearsal.error);
  step.addOutput("dry_run", { after_identity: rehearsal.afterIdentity });
  session.succeedStep(step);
  const commitStep = session.startStep("commit");
  session.reach("commit");
  if (session.signal.aborted) {
    return session.cancel(cancelledError("Run was cancelled before commit"), "before_commit");
  }
  const committed = commitRehearsedPatch({
    binding: session.binding,
    patch,
    patchSummary,
    rehearsal,
    intent: plan.intent,
    target,
    registry: policy.registry,
    actions: session.configuration.actions,
    embeddedIdentityDelta: session.configuration.embeddedIdentityDelta,
  });
  if (!committed.ok) return session.fail(committed.error);
  const evidence = commitEvidence(committed.kind, committed.metadata);
  commitStep.addOutput("commit_kind", evidence.commit_kind);
  commitStep.addOutput("metadata", evidence.metadata);
  session.succeedStep(commitStep);
  return session.succeed(committed.scene, committed.revision, commitTerminal(committed.metadata));
}
