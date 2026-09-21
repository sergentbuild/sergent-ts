import type { Intent, MindBuf, Operation, Target } from "sergent-ts-core";
import type { RunObserver, SergentResult } from "sergent-ts-observability";

import type { RunDelivery } from "../delivery/index.js";
import type { SharedSceneAuthority } from "../scene-authority/index.js";
import type { RuntimeConfiguration } from "./configuration.js";
import { executePipeline } from "./pipeline.js";

/** Private Scene type carrier for opaque configured run values. */
declare const configuredScene: unique symbol;

/** Private executor reachable only by the execution unit's invocation function. */
const configuredExecutor: unique symbol = Symbol("configuredExecutor");

/** Private captured observer slots read only when invocation creates delivery. */
const configuredObservers: unique symbol = Symbol("configuredObservers");

/** One captured single-use executor with all phase generics closed over. */
type ConfiguredExecutor<Scene> = (
  input: Scene | SharedSceneAuthority<Scene>,
  mindBuf: MindBuf,
  signal: AbortSignal,
  delivery: RunDelivery<Scene>,
) => Promise<SergentResult<Scene>>;

/** One reservation gate that returns the only executable closure once. */
type ConfiguredConsumer<Scene> = () => ConfiguredExecutor<Scene>;

/** Opaque single-use configured run consumed only by invocation. */
export interface ConfiguredRun<Scene> {
  readonly kind: "intent_only" | "plan_capable";
  readonly [configuredScene]?: (scene: Scene) => Scene;
  readonly [configuredExecutor]: ConfiguredConsumer<Scene>;
  readonly [configuredObservers]: readonly RunObserver<Scene>[];
}

/** Opaque configured run whose Recipe can only stop. */
export interface IntentOnlyConfiguredRun<Scene> extends ConfiguredRun<Scene> {
  readonly kind: "intent_only";
}

/** Opaque configured run with one captured closed Operation registry. */
export interface PlanCapableConfiguredRun<Scene> extends ConfiguredRun<Scene> {
  readonly kind: "plan_capable";
}

/** Closes one typed configuration into a consumed-at-most-once executor. */
function singleUseConsumer<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  configuration: RuntimeConfiguration<Proposal, IntentValue, Scene, TargetValue, OperationData>,
): ConfiguredConsumer<Scene> {
  let consumed = false;
  const execute: ConfiguredExecutor<Scene> = (input, mindBuf, signal, delivery) =>
    executePipeline(configuration, input, mindBuf, signal, delivery);
  return () => {
    if (consumed) throw new TypeError("Configured run is already invoked");
    consumed = true;
    return execute;
  };
}

/** Creates one opaque Intent-only configured run. */
export function createIntentOnlyConfiguredRun<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  configuration: RuntimeConfiguration<Proposal, IntentValue, Scene, TargetValue, OperationData>,
): IntentOnlyConfiguredRun<Scene> {
  return {
    kind: "intent_only",
    [configuredExecutor]: singleUseConsumer(configuration),
    [configuredObservers]: configuration.observers,
  };
}

/** Creates one opaque Plan-capable configured run. */
export function createPlanCapableConfiguredRun<
  Proposal,
  IntentValue extends Intent,
  Scene,
  TargetValue extends Target,
  OperationData extends Operation,
>(
  configuration: RuntimeConfiguration<Proposal, IntentValue, Scene, TargetValue, OperationData>,
): PlanCapableConfiguredRun<Scene> {
  return {
    kind: "plan_capable",
    [configuredExecutor]: singleUseConsumer(configuration),
    [configuredObservers]: configuration.observers,
  };
}

/** Returns the already-captured observer slots for delivery construction. */
export function configuredRunObservers<Scene>(
  configured: ConfiguredRun<Scene>,
): readonly RunObserver<Scene>[] {
  return configured[configuredObservers];
}

/** Starts the private executor held by one opaque configured run. */
export function consumeConfiguredRun<Scene>(
  configured: ConfiguredRun<Scene>,
): ConfiguredExecutor<Scene> {
  return configured[configuredExecutor]();
}
