import { patchValidationError, validationError } from "sergent-ts-core";
import type {
  Intent,
  JsonObject,
  Operation,
  Patch,
  RunError,
  SceneActions,
  SceneIdentity,
  Target,
  ValidationIssue,
} from "sergent-ts-core";

import { isolatePatch } from "./patch-isolation.js";

/** Complete inputs for one deterministic isolated Patch rehearsal. */
export interface RehearsalRequest<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
> {
  readonly before: Scene;
  readonly beforeIdentity: SceneIdentity;
  readonly patch: Patch<OperationData>;
  readonly intent: IntentValue;
  readonly target: TargetValue;
  readonly actions: SceneActions<Scene, TargetValue, IntentValue, OperationData>;
  readonly embeddedIdentityDelta: number | null;
}

/** Accepted candidate or one expected deterministic rehearsal failure. */
export type RehearsalResult<Scene> =
  | Readonly<{ ok: true; scene: Scene; afterIdentity: SceneIdentity }>
  | Readonly<{ ok: false; error: RunError }>;

/** Projects verification issues into isolated JSON metadata. */
function verificationMetadata(issues: readonly ValidationIssue[]): JsonObject {
  return {
    verification_issues: issues.map((issue) => ({
      kind: issue.kind,
      message: issue.message,
      metadata: issue.metadata,
    })),
  };
}

/** Returns an embedded-identity rejection when the configured relation fails. */
function identityError(
  before: SceneIdentity,
  after: SceneIdentity,
  delta: number | null,
): RunError | null {
  if (delta === null) return null;
  const expectedRevision = before.revision + delta;
  if (!Number.isSafeInteger(expectedRevision)) {
    throw new RangeError("Embedded Scene revision overflow");
  }
  if (after.scene_id === before.scene_id && after.revision === expectedRevision) return null;
  return patchValidationError("Embedded Scene identity did not advance as configured", {
    identity_issues: ["scene_id_or_revision_mismatch"],
    expected_identity: { scene_id: before.scene_id, revision: expectedRevision },
    actual_identity: { scene_id: after.scene_id, revision: after.revision },
  });
}

/** Applies and verifies one complete Patch on one evolving isolated candidate. */
export function rehearsePatch<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  request: RehearsalRequest<Scene, TargetValue, IntentValue, OperationData>,
): RehearsalResult<Scene> {
  const candidate = request.actions.clone(request.before);
  const application = request.actions.apply(
    candidate,
    isolatePatch(request.patch),
    request.intent,
    request.target,
  );
  if (!application.ok) return { ok: false, error: application.fault.error };
  const report = request.actions.verify(
    request.before,
    application.scene,
    request.intent,
    request.target,
  );
  if (report.issues.length > 0) {
    return {
      ok: false,
      error: validationError(
        "Scene verification rejected the Patch",
        verificationMetadata(report.issues),
      ),
    };
  }
  const embeddedAfter = request.actions.identity(application.scene);
  const afterIdentity: SceneIdentity = {
    scene_id: embeddedAfter.scene_id,
    revision: embeddedAfter.revision,
  };
  const embeddedError = identityError(
    request.beforeIdentity,
    afterIdentity,
    request.embeddedIdentityDelta,
  );
  if (embeddedError !== null) return { ok: false, error: embeddedError };
  return { ok: true, scene: application.scene, afterIdentity };
}
