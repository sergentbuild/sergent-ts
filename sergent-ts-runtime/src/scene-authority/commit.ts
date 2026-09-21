import { mergeConflictError, stalePatchError } from "sergent-ts-core";
import type {
  Intent,
  JsonObject,
  Operation,
  OperationRegistry,
  Patch,
  RunError,
  SceneActions,
  SceneIdentity,
  Target,
} from "sergent-ts-core";
import type { CommitKind } from "sergent-ts-observability";

import type { BoundScene } from "./binding.js";
import { rehearsePatch } from "./rehearsal.js";
import type { RehearsalResult } from "./rehearsal.js";
import { isolatePatch } from "./patch-isolation.js";
import { installSharedScene, sharedScenePolicy } from "./shared-authority.js";
import { checkAdmissibility, validateRebasedPatch } from "./validation.js";

/** Complete synchronous commit request after the original rehearsal succeeds. */
export interface CommitRequest<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
> {
  readonly binding: BoundScene<Scene>;
  readonly patch: Patch<OperationData>;
  readonly patchSummary: JsonObject;
  readonly rehearsal: Extract<RehearsalResult<Scene>, { readonly ok: true }>;
  readonly intent: IntentValue;
  readonly target: TargetValue;
  readonly registry: OperationRegistry<OperationData, Scene, IntentValue, TargetValue>;
  readonly actions: SceneActions<Scene, TargetValue, IntentValue, OperationData>;
  readonly embeddedIdentityDelta: number | null;
}

/** Successful committed Scene or one expected shared-authority failure. */
export type CommitResult<Scene> =
  | Readonly<{
      ok: true;
      scene: Scene;
      revision: number;
      kind: CommitKind;
      metadata: JsonObject;
    }>
  | Readonly<{ ok: false; error: RunError }>;

/** Creates the required common merge-conflict evidence. */
function mergeError<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  request: CommitRequest<Scene, TargetValue, IntentValue, OperationData>,
  currentRevision: number,
  message: string,
  sceneMetadata: JsonObject = {},
  validationError: JsonObject | null = null,
): RunError<"merge_conflict"> {
  return mergeConflictError(message, {
    base_revision: request.patch.base.revision,
    current_live_revision: currentRevision,
    patch: request.patchSummary,
    scene_metadata: sceneMetadata,
    ...(validationError === null ? {} : { validation_error: validationError }),
  });
}

/** Rehearses and revision-checks one application-supplied replacement Patch. */
function commitRebase<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  request: CommitRequest<Scene, TargetValue, IntentValue, OperationData>,
  current: Scene,
  currentIdentity: SceneIdentity,
  currentEmbeddedIdentity: SceneIdentity,
): CommitResult<Scene> {
  if (request.actions.rebase === undefined) {
    return {
      ok: false,
      error: mergeError(
        request,
        currentIdentity.revision,
        "Shared Scene has no rebase implementation",
      ),
    };
  }
  const replacement = request.actions.rebase(
    isolatePatch(request.patch),
    request.binding.base,
    current,
    request.intent,
    request.target,
  );
  if (replacement.kind === "conflict") {
    return {
      ok: false,
      error: mergeError(
        request,
        currentIdentity.revision,
        replacement.error.message,
        replacement.error.metadata,
      ),
    };
  }
  return validateAndInstallRebase(
    request,
    current,
    currentIdentity,
    currentEmbeddedIdentity,
    isolatePatch(replacement.patch),
    replacement.metadata,
  );
}

/** Validates, rehearses, and installs one deterministic rebase replacement. */
function validateAndInstallRebase<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  request: CommitRequest<Scene, TargetValue, IntentValue, OperationData>,
  current: Scene,
  identity: SceneIdentity,
  embeddedIdentity: SceneIdentity,
  replacement: Patch<OperationData>,
  metadata: JsonObject,
): CommitResult<Scene> {
  const validated = validateRebasedPatch({
    original: request.patch,
    replacement,
    current,
    currentIdentity: identity,
    target: request.target,
    registry: request.registry,
    actions: request.actions,
  });
  if (!validated.ok) {
    return rebaseFailure(request, identity.revision, validated.error, metadata, "patch_validation");
  }
  const admissibility = checkAdmissibility(
    current,
    request.intent,
    request.target,
    validated.value.steps,
    request.registry,
    request.actions,
  );
  if (!admissibility.ok) {
    return rebaseFailure(
      request,
      identity.revision,
      admissibility.error,
      metadata,
      "operation_admissibility",
    );
  }
  return rehearseAndInstall(
    request,
    current,
    identity,
    embeddedIdentity,
    validated.value,
    metadata,
  );
}

/** Converts a replacement-stage rejection to the structured merge vocabulary. */
function rebaseFailure<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  request: CommitRequest<Scene, TargetValue, IntentValue, OperationData>,
  currentRevision: number,
  error: RunError,
  metadata: JsonObject,
  kind: string,
): CommitResult<Scene> {
  return {
    ok: false,
    error: mergeError(request, currentRevision, error.message, metadata, {
      kind,
      message: error.message,
      metadata: error.metadata,
    }),
  };
}

/** Dry-runs a validated replacement and commits through the second check. */
function rehearseAndInstall<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  request: CommitRequest<Scene, TargetValue, IntentValue, OperationData>,
  current: Scene,
  identity: SceneIdentity,
  embeddedIdentity: SceneIdentity,
  patch: Patch<OperationData>,
  metadata: JsonObject,
): CommitResult<Scene> {
  const rehearsal = rehearsePatch({
    before: current,
    beforeIdentity: embeddedIdentity,
    patch,
    intent: request.intent,
    target: request.target,
    actions: request.actions,
    embeddedIdentityDelta: request.embeddedIdentityDelta,
  });
  if (!rehearsal.ok) {
    return rebaseFailure(request, identity.revision, rehearsal.error, metadata, "dry_run");
  }
  const shared = request.binding.shared;
  if (shared === null) throw new TypeError("Rebase requires shared Scene authority");
  const installed = installSharedScene(shared, identity.revision, rehearsal.scene);
  if (!installed.ok) {
    return {
      ok: false,
      error: mergeError(request, installed.currentRevision, "Shared Scene advanced during rebase"),
    };
  }
  return {
    ok: true,
    scene: installed.scene,
    revision: installed.revision,
    kind: "rebased",
    metadata,
  };
}

/** Commits the successful original rehearsal through plain or shared authority. */
export function commitRehearsedPatch<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(request: CommitRequest<Scene, TargetValue, IntentValue, OperationData>): CommitResult<Scene> {
  const shared = request.binding.shared;
  if (shared === null) {
    return {
      ok: true,
      scene: request.rehearsal.scene,
      revision: request.rehearsal.afterIdentity.revision,
      kind: "plain",
      metadata: {},
    };
  }
  const current = shared.read();
  if (current.revision === request.patch.base.revision) {
    const installed = installSharedScene(shared, current.revision, request.rehearsal.scene);
    if (installed.ok) {
      return {
        ok: true,
        scene: installed.scene,
        revision: installed.revision,
        kind: "exact",
        metadata: {},
      };
    }
  }
  const latest = shared.read();
  if (sharedScenePolicy(shared) === "strict") {
    return {
      ok: false,
      error: stalePatchError(
        "Shared Scene advanced before commit",
        request.patch.base.revision,
        latest.revision,
      ),
    };
  }
  const currentEmbedded = request.actions.identity(latest.scene);
  const embedded: SceneIdentity = {
    scene_id: currentEmbedded.scene_id,
    revision: currentEmbedded.revision,
  };
  const identity: SceneIdentity = { scene_id: embedded.scene_id, revision: latest.revision };
  return commitRebase(request, latest.scene, identity, embedded);
}
