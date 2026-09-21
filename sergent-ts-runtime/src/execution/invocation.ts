import { mintRunId } from "sergent-ts-core";
import type { MindBuf } from "sergent-ts-core";

import { createRunDelivery, createRunHandle } from "../delivery/index.js";
import type { RunHandle } from "../delivery/index.js";
import type { SharedSceneAuthority } from "../scene-authority/index.js";
import type { ConfiguredRun } from "./configured-run.js";
import { configuredRunObservers, consumeConfiguredRun } from "./configured-run.js";

/** Consumes one configured run and starts its inspectable asynchronous invocation. */
export function invokeRun<Scene>(
  configured: ConfiguredRun<Scene>,
  scene: Scene | SharedSceneAuthority<Scene>,
  mindBuf: MindBuf,
  signal: AbortSignal,
): RunHandle<Scene> {
  const execute = consumeConfiguredRun(configured);
  const runId = mintRunId();
  const delivery = createRunDelivery(runId, configuredRunObservers(configured));
  delivery.queued();
  const result = execute(scene, mindBuf, signal, delivery);
  return createRunHandle(runId, delivery, result);
}
