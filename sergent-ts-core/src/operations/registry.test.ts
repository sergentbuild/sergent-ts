import { describe, expect, expectTypeOf, test } from "bun:test";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import type { SceneId } from "../values/index.js";
import {
  compilePatch,
  createExecutionPlan,
  createOperationRegistry,
  defineOperation,
} from "./index.js";
import type { OperationDefinitionBase } from "./types.js";

/** Reports whether one exact definition tuple satisfies registry construction. */
type RegistryAccepts<Definitions extends readonly OperationDefinitionBase[]> =
  Definitions extends Parameters<typeof createOperationRegistry<Definitions>>[0] ? true : false;

/** First registry Scene context used for invariant type proofs. */
interface SceneA {
  readonly sceneA: string;
}

/** Incompatible registry Scene context. */
interface SceneB {
  readonly sceneB: string;
}

/** First registry Intent context used for invariant type proofs. */
interface IntentA {
  readonly flow: "continue";
  readonly intentA: string;
}

/** Incompatible registry Intent context. */
interface IntentB {
  readonly flow: "stop";
  readonly intentB: string;
}

/** First registry Target context used for invariant type proofs. */
interface TargetA {
  readonly targetA: string;
}

/** Incompatible registry Target context. */
interface TargetB {
  readonly targetB: string;
}

/** A nested operand schema that makes Patch aliasing observable. */
const renameOperands = Type.Object(
  {
    name: Type.String(),
    options: Type.Object({ labels: Type.Array(Type.String()) }, { additionalProperties: false }),
  },
  { additionalProperties: false },
);

/** A second distinct Operation branch. */
const tagOperands = Type.Object({ tag: Type.String() }, { additionalProperties: false });

/** Constructs the representative two-operation registry. */
function registry(maximum: number | null = 2) {
  return createOperationRegistry(
    [defineOperation("rename", renameOperands), defineOperation("tag", tagOperands)],
    maximum,
  );
}

/** Authors an operand schema with one named shared definition. */
function sharedOperands(shared: TSchema, name = "Shared") {
  const definitions = Object.fromEntries([[name, shared]]);
  return Type.Object(
    { payload: Type.Ref(`#/$defs/${name}`) },
    { additionalProperties: false, $defs: definitions },
  );
}

describe("Operation registry", () => {
  test("compose exact operations and fixed call wire shapes", () => {
    const value = registry();
    const schema = value.plan_proposal.proposal_schema.json_schema;

    expect(value.plan_proposal.proposal_schema.name).toBe("PlanProposal");
    expect(JSON.stringify(schema)).toBe(
      '{"type":"object","required":["operations"],"properties":{"operations":{"type":"array","items":{"anyOf":[{"type":"object","required":["call","name","options"],"properties":{"call":{"enum":["rename"]},"name":{"type":"string"},"options":{"type":"object","required":["labels"],"properties":{"labels":{"type":"array","items":{"type":"string"}}},"additionalProperties":false}},"additionalProperties":false},{"type":"object","required":["call","tag"],"properties":{"call":{"enum":["tag"]},"tag":{"type":"string"}},"additionalProperties":false}]},"minItems":1,"maxItems":2}},"additionalProperties":false}',
    );
  });

  test("strictly decode once and assign distinct framework Operation IDs", () => {
    const result = registry().decodePlan({
      operations: [
        { call: "rename", name: "new", options: { labels: ["one"] } },
        { call: "tag", tag: "stable" },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.op_id).toMatch(/^op_[0-9a-f]{32}$/);
    expect(result.steps[1]?.op_id).toMatch(/^op_[0-9a-f]{32}$/);
    expect(result.steps[0]?.op_id).not.toBe(result.steps[1]?.op_id);
    expect(result.steps.map((step) => step.operation.call)).toEqual(["rename", "tag"]);
    expect("op_id" in (result.steps[0]?.operation ?? {})).toBe(false);
  });

  test("reject unknown envelopes, calls, operands, bookkeeping, and count violations", () => {
    const value = registry(1);
    const rejected = [
      {},
      { operations: [], run_id: "run_00000000000000000000000000000000" },
      { operations: [] },
      { operations: [{ call: "unknown" }] },
      { operations: [{ call: "tag", tag: "x", extra: true }] },
      { operations: [{ call: "tag", tag: "x", op_id: "op_echo" }] },
      {
        operations: [
          { call: "tag", tag: "x" },
          { call: "tag", tag: "y" },
        ],
      },
    ];

    for (const proposal of rejected) expect(value.decodePlan(proposal).ok).toBe(false);
    expect(value.decodeOperation("tag", null).ok).toBe(false);
    expect(value.decodeOperation("tag", { call: "other" }).ok).toBe(false);
    expect(
      value.decodeOperation("tag", {
        call: "rename",
        name: "new",
        options: { labels: ["one"] },
      }).ok,
    ).toBe(false);
  });
});

describe("Operation definition and composition construction", () => {
  test("require one invariant Scene, Intent, and Target context per registry", () => {
    const first = defineOperation<"first", typeof tagOperands, SceneA, IntentA, TargetA>(
      "first",
      tagOperands,
    );
    const compatible = defineOperation<"compatible", typeof tagOperands, SceneA, IntentA, TargetA>(
      "compatible",
      tagOperands,
    );
    const sceneMismatch = defineOperation<"scene", typeof tagOperands, SceneB, IntentA, TargetA>(
      "scene",
      tagOperands,
    );
    const intentMismatch = defineOperation<"intent", typeof tagOperands, SceneA, IntentB, TargetA>(
      "intent",
      tagOperands,
    );
    const targetMismatch = defineOperation<"target", typeof tagOperands, SceneA, IntentA, TargetB>(
      "target",
      tagOperands,
    );

    expectTypeOf<
      RegistryAccepts<readonly [typeof first, typeof compatible]>
    >().toEqualTypeOf<true>();
    expectTypeOf<
      RegistryAccepts<readonly [typeof first, typeof sceneMismatch]>
    >().toEqualTypeOf<false>();
    expectTypeOf<
      RegistryAccepts<readonly [typeof first, typeof intentMismatch]>
    >().toEqualTypeOf<false>();
    expectTypeOf<
      RegistryAccepts<readonly [typeof first, typeof targetMismatch]>
    >().toEqualTypeOf<false>();
  });
});

describe("Operation definition and composition construction", () => {
  test("reject invalid membership, bounds, reserved operands, and duplicate calls", () => {
    expect(() => Reflect.apply(createOperationRegistry, null, [[]])).toThrow(TypeError);
    expect(() => registry(0)).toThrow(TypeError);
    expect(() => registry(1.5)).toThrow(TypeError);
    expect(() =>
      createOperationRegistry([
        defineOperation("same", Type.Object({}, { required: [], additionalProperties: false })),
        defineOperation("same", Type.Object({ x: Type.String() }, { additionalProperties: false })),
      ]),
    ).toThrow(TypeError);
    expect(() =>
      defineOperation("", Type.Object({}, { required: [], additionalProperties: false })),
    ).toThrow(TypeError);
    expect(() =>
      defineOperation(
        "reserved",
        Type.Object({ call: Type.String() }, { additionalProperties: false }),
      ),
    ).toThrow(TypeError);
  });

  test("reuse equal shared definitions and reject conflicting same-name definitions", () => {
    const sharedA = Type.Object({ value: Type.String() }, { additionalProperties: false });
    const sharedB = Type.Object({ value: Type.String() }, { additionalProperties: false });
    const sharedConflict = Type.Object({ value: Type.Number() }, { additionalProperties: false });
    expect(() =>
      createOperationRegistry([
        defineOperation("left", sharedOperands(sharedA)),
        defineOperation("right", sharedOperands(sharedB)),
      ]),
    ).not.toThrow();
    expect(() =>
      createOperationRegistry([
        defineOperation("left", sharedOperands(sharedA)),
        defineOperation("right", sharedOperands(sharedConflict)),
      ]),
    ).toThrow("Conflicting schema definition: Shared");
  });

  test("merge own prototype-shaped definition names without inherited collisions", () => {
    const shared = Type.Object({ value: Type.String() }, { additionalProperties: false });
    const conflict = Type.Object({ value: Type.Number() }, { additionalProperties: false });
    for (const name of ["toString", "valueOf"]) {
      expect(() =>
        createOperationRegistry([
          defineOperation(`${name}_left`, sharedOperands(shared, name)),
          defineOperation(`${name}_right`, sharedOperands(shared, name)),
        ]),
      ).not.toThrow();
      expect(() =>
        createOperationRegistry([
          defineOperation(`${name}_left`, sharedOperands(shared, name)),
          defineOperation(`${name}_right`, sharedOperands(conflict, name)),
        ]),
      ).toThrow(`Conflicting schema definition: ${name}`);
    }
  });
});

describe("Plan and Patch mechanics", () => {
  test("compile isolated Patch steps while preserving base, order, calls, and IDs", () => {
    const decoded = registry().decodePlan({
      operations: [{ call: "rename", name: "new", options: { labels: ["one"] } }],
    });
    if (!decoded.ok) throw new Error("Fixture Plan failed to decode");
    const base = { scene_id: "scene_00000000000000000000000000000000" as SceneId, revision: 3 };
    const intent = { flow: "continue" as const, reason: "rename" };
    const plan = createExecutionPlan(base, intent, decoded.steps);
    const patch = compilePatch(plan);
    const planOperation = decoded.steps[0]?.operation;
    const patchOperation = patch.steps[0]?.operation;
    if (planOperation?.call !== "rename" || patchOperation?.call !== "rename") {
      throw new Error("Fixture Operation branch changed");
    }

    expect(patch.base).toBe(base);
    expect(patch.steps[0]?.op_id).toBe(decoded.steps[0]?.op_id);
    expect(patchOperation).not.toBe(planOperation);
    expect(patchOperation.options).not.toBe(planOperation.options);
    patchOperation.options.labels.push("patch-only");
    expect(planOperation.options.labels).toEqual(["one"]);
  });

  test("dispatch optional admissibility from the exact registered definition", () => {
    const seen: unknown[] = [];
    const definition = defineOperation(
      "inspect",
      Type.Object({ value: Type.String() }, { additionalProperties: false }),
      (operation, context) => {
        seen.push(operation, context.scene, context.intent, context.target);
        return { ok: true };
      },
    );
    const value = createOperationRegistry([definition]);
    const decoded = value.decodePlan({ operations: [{ call: "inspect", value: "x" }] });
    if (!decoded.ok) throw new Error("Fixture Plan failed to decode");
    const context = {
      scene: { revision: 1 },
      intent: { flow: "continue" as const },
      target: { id: "selected" },
    };

    const step = decoded.steps[0];
    if (step === undefined) throw new Error("Fixture Plan has no step");
    expect(value.checkAdmissibility(step, context)).toEqual({ ok: true });
    expect(seen).toEqual([
      decoded.steps[0]?.operation,
      context.scene,
      context.intent,
      context.target,
    ]);
  });
});
