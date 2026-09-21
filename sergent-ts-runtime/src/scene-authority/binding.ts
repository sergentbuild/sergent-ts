import type { Intent, Operation, SceneActions, SceneIdentity, Target } from "sergent-ts-core";

import { isSharedSceneAuthority, SharedSceneAuthority } from "./shared-authority.js";

/** One isolated run base and its optional shared commit authority. */
export interface BoundScene<Scene> {
  readonly base: Scene;
  readonly identity: SceneIdentity;
  readonly embeddedIdentity: SceneIdentity;
  readonly shared: SharedSceneAuthority<Scene> | null;
}

/** Binds either a cloned plain snapshot or one isolated shared-state read. */
export function bindSceneInput<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData extends Operation,
>(
  input: Scene | SharedSceneAuthority<Scene>,
  actions: SceneActions<Scene, TargetValue, IntentValue, OperationData>,
): BoundScene<Scene> {
  if (isSharedSceneAuthority(input)) {
    const shared = input;
    const snapshot = shared.read();
    const embedded = actions.identity(snapshot.scene);
    return {
      base: snapshot.scene,
      identity: { scene_id: embedded.scene_id, revision: snapshot.revision },
      embeddedIdentity: {
        scene_id: embedded.scene_id,
        revision: embedded.revision,
      },
      shared,
    };
  }
  const base = actions.clone(input);
  const embedded = actions.identity(base);
  const identity: SceneIdentity = {
    scene_id: embedded.scene_id,
    revision: embedded.revision,
  };
  return { base, identity, embeddedIdentity: identity, shared: null };
}
