import { describe, expect, expectTypeOf, test } from "bun:test";
import { Type } from "typebox";

import { createMessages, createUserMessage } from "../model-request/index.js";
import { createOperationRegistry, defineOperation } from "../operations/index.js";
import type { SceneId } from "../values/index.js";
import { runError } from "../values/index.js";
import {
  createIntentOnlyRecipe,
  createPlanCapableRecipe,
  PASS_THROUGH_INTENT_PROPOSAL,
  recipeValid,
} from "./index.js";
import type { PassThroughIntentProposal } from "./index.js";

/** Representative application Scene used to prove Recipe generic binding. */
interface ExampleScene {
  readonly value: string;
}

/** Representative selected application Target. */
interface ExampleTarget {
  readonly id: string;
}

/** Representative stop Intent with application decision data. */
interface ExampleStopIntent {
  readonly flow: "stop";
  readonly reason: string;
}

/** Representative Plan-capable application Intent. */
type ExampleIntent = ExampleStopIntent | { readonly flow: "continue"; readonly reason: string };

/** Shared constructed messages for Recipe fixtures. */
const messages = createMessages([createUserMessage("decide")]);

describe("Recipe construction", () => {
  test("construct an Intent-only shape that derives only stop Intents", () => {
    const recipe = createIntentOnlyRecipe({
      noTargetError: runError("no_target", "No target"),
      buildIntentMessages: () => messages,
      deriveIntent: (_proposal: { readonly decision: "stop" }): ExampleStopIntent => ({
        flow: "stop",
        reason: "complete",
      }),
      validateIntent: () => recipeValid(),
      stopTerminal: () => ({ data: "done", metadata: {} }),
    });

    expect(recipe.kind).toBe("intent_only");
    expect(recipe.registry).toBeNull();
    expectTypeOf(recipe.registry).toEqualTypeOf<null>();
    expect(
      recipe.deriveIntent(
        { decision: "stop" },
        {
          scene: { value: "x" },
          target: { id: "selected" },
          mindBuf: "recent",
        },
      ).flow,
    ).toBe("stop");
  });
});

describe("Plan-capable Recipe construction", () => {
  test("construct a Plan-capable shape with default derivation and isolated compilation", () => {
    const operands = Type.Object({ value: Type.String() }, { additionalProperties: false });
    const definition = defineOperation<
      "set_value",
      typeof operands,
      ExampleScene,
      ExampleIntent,
      ExampleTarget
    >("set_value", operands);
    const registry = createOperationRegistry([definition]);
    const recipe = createPlanCapableRecipe({
      registry,
      noTargetError: runError("no_target", "No target"),
      buildIntentMessages: () => messages,
      buildPlanMessages: () => messages,
      deriveIntent: (_proposal: PassThroughIntentProposal): ExampleIntent => ({
        flow: "continue",
        reason: "change",
      }),
      validateIntent: () => recipeValid(),
      validatePlan: () => recipeValid(),
      stopTerminal: () => ({ data: null, metadata: {} }),
    });
    const decoded = registry.decodePlan({
      operations: [{ call: "set_value", value: "after" }],
    });
    if (!decoded.ok) throw new Error("Fixture Plan failed to decode");
    const base = {
      scene_id: "scene_00000000000000000000000000000000" as SceneId,
      revision: 1,
    };
    const intent = { flow: "continue" as const, reason: "change" };
    const context = {
      scene: { value: "before" },
      target: { id: "selected" },
      mindBuf: "recent",
    };
    expect(recipe.deriveIntent(PASS_THROUGH_INTENT_PROPOSAL, context).flow).toBe("continue");
    const plan = recipe.derivePlan(base, intent, decoded.steps, context);
    const patch = recipe.compilePatch(plan);

    expect(recipe.kind).toBe("plan_capable");
    expect(recipe.registry).toBe(registry);
    expect(plan).toEqual({ base, intent, steps: decoded.steps });
    expect(patch.steps).not.toBe(plan.steps);
    expect(patch.steps[0]?.operation).not.toBe(plan.steps[0]?.operation);
  });
});
