import { describe, expect, test } from "bun:test";
import { Type } from "typebox";
import type { TSchema } from "typebox";

import { createProposalDefinition } from "./index.js";

/** Creates a closed canonical object around supplied properties. */
function closed(properties: Record<string, TSchema>): TSchema {
  return Type.Object(properties, {
    required: Object.keys(properties),
    additionalProperties: false,
  });
}

/** Authors a deliberately raw TypeBox schema for dialect rejection tests. */
function raw(schema: Record<string, unknown>): TSchema {
  return Type.Unsafe<unknown>(schema);
}

/** Proves construction fails before a provider can receive the schema. */
function expectRejected(schema: TSchema): void {
  expect(() => createProposalDefinition("Example", schema)).toThrow(TypeError);
}

/** Creates a canonical root schema with an optional definitions table. */
function referencedRoot(value: TSchema, definitions: Record<string, TSchema> = {}): TSchema {
  return Type.Object(
    { value },
    { required: ["value"], additionalProperties: false, $defs: definitions },
  );
}

describe("canonical proposal definitions", () => {
  test("accept every canonical node form and retain exact schema identity", () => {
    const shared = closed({ label: Type.String({ description: "A label" }) });
    const schema = Type.Object(
      {
        array: Type.Array(Type.Ref("#/$defs/Shared"), { minItems: 0, maxItems: 3 }),
        boolean: Type.Boolean(),
        choice: Type.Union([Type.String(), Type.Null()]),
        count: Type.Integer({ minimum: -2, maximum: 5 }),
        mode: Type.Enum(["one", "two"]),
        nothing: Type.Null(),
        ratio: Type.Number({ minimum: -0.5, maximum: 1.5 }),
        text: Type.String(),
      },
      {
        additionalProperties: false,
        description: "All canonical forms",
        $defs: { Shared: shared },
      },
    );

    const definition = createProposalDefinition("Example_1", schema);

    expect(definition.proposal_schema.json_schema).toBe(schema);
    expect(
      definition.decode({
        array: [{ label: "ok" }],
        boolean: true,
        choice: null,
        count: 1,
        mode: "two",
        nothing: null,
        ratio: 0.25,
        text: "value",
      }).ok,
    ).toBe(true);
  });

  test("strict decode rejects unknown fields without repairing input", () => {
    const schema = closed({ value: Type.String() });
    const definition = createProposalDefinition("Strict", schema);
    const input = { value: "kept", extra: "rejected" };

    const result = definition.decode(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("schema_validation_failed");
    expect(input).toEqual({ value: "kept", extra: "rejected" });
  });

  test("proposal names follow the exact stable ASCII grammar", () => {
    const schema = closed({});
    for (const name of ["", "a".repeat(65), "has space", "slash/name", "non\u0061scii\u00e9"]) {
      expect(() => createProposalDefinition(name, schema)).toThrow(TypeError);
    }
    for (const name of ["a", "A_1-x", "9".repeat(64)]) {
      expect(createProposalDefinition(name, schema).proposal_schema.name).toBe(name);
    }
  });
});

describe("canonical proposal structural rejection", () => {
  test("reject root references, unions, arrays, and missing object closure", () => {
    expectRejected(Type.Ref("#/$defs/Value"));
    expectRejected(Type.Union([closed({}), closed({ value: Type.String() })]));
    expectRejected(Type.Array(Type.String()));
    expectRejected(Type.Object({ value: Type.String() }));
    expectRejected(raw({ type: "object", properties: {}, additionalProperties: false }));
  });

  test("reject unknown keywords and noncanonical native TypeBox forms", () => {
    expectRejected(
      raw({
        type: "object",
        properties: { value: { type: "string", pattern: "x" } },
        required: ["value"],
        additionalProperties: false,
      }),
    );
    expectRejected(
      raw({
        type: "object",
        properties: { value: { const: "x", type: "string" } },
        required: ["value"],
        additionalProperties: false,
      }),
    );
    expectRejected(
      raw({
        type: "object",
        properties: { value: { type: ["string", "null"] } },
        required: ["value"],
        additionalProperties: false,
      }),
    );
    expectRejected(
      raw({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      }),
    );
  });
});

describe("canonical proposal constraint rejection", () => {
  test("reject open, incomplete, duplicated, and extraneous object requirements", () => {
    expectRejected(
      raw({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: true,
      }),
    );
    expectRejected(
      raw({
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      }),
    );
    expectRejected(
      raw({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a", "a"],
        additionalProperties: false,
      }),
    );
    expectRejected(
      raw({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a", "b"],
        additionalProperties: false,
      }),
    );
  });

  test("reject arrays without items and invalid inclusive item bounds", () => {
    const envelope = (item: Record<string, unknown>): TSchema =>
      raw({
        type: "object",
        properties: { values: item },
        required: ["values"],
        additionalProperties: false,
      });
    expectRejected(envelope({ type: "array" }));
    expectRejected(envelope({ type: "array", items: { type: "string" }, minItems: -1 }));
    expectRejected(envelope({ type: "array", items: { type: "string" }, maxItems: 1.5 }));
    expectRejected(
      envelope({ type: "array", items: { type: "string" }, minItems: 2, maxItems: 1 }),
    );
  });

  test("reject invalid numeric bounds and scalar enums", () => {
    const envelope = (value: Record<string, unknown>): TSchema =>
      raw({
        type: "object",
        properties: { value },
        required: ["value"],
        additionalProperties: false,
      });
    expectRejected(envelope({ type: "number", minimum: 2, maximum: 1 }));
    expectRejected(envelope({ type: "number", minimum: Number.POSITIVE_INFINITY }));
    expectRejected(envelope({ enum: [] }));
    expectRejected(envelope({ enum: [{ nested: true }] }));
    expectRejected(envelope({ enum: ["same", "same"] }));
    expectRejected(envelope({ type: "integer", enum: [1.5] }));
  });
});

describe("canonical proposal node-vocabulary rejection", () => {
  test("reject malformed descriptions, types, definitions, and object keywords", () => {
    expectRejected(
      raw({
        type: "object",
        properties: { value: { type: "string", description: 1 } },
        required: ["value"],
        additionalProperties: false,
      }),
    );
    expectRejected(
      raw({
        type: "object",
        properties: { value: { type: "date" } },
        required: ["value"],
        additionalProperties: false,
      }),
    );
    expectRejected(raw({ type: "object", required: [], additionalProperties: false }));
    expectRejected(
      raw({ type: "object", properties: {}, required: "none", additionalProperties: false }),
    );
    expectRejected(raw({ type: "object", properties: {}, additionalProperties: false, $defs: [] }));
    expectRejected(
      raw({
        type: "object",
        properties: {},
        additionalProperties: false,
        $defs: { "invalid/name": { type: "string" } },
      }),
    );
  });

  test("reject malformed unions, enums, and declared enum types", () => {
    expectRejected(closed({ value: raw({ anyOf: [] }) }));
    expectRejected(closed({ value: raw({ anyOf: { type: "string" } }) }));
    expectRejected(closed({ value: raw({ type: "string", enum: [1] }) }));
    expectRejected(closed({ value: raw({ type: "boolean", enum: ["true"] }) }));
    expectRejected(closed({ value: raw({ type: "null", enum: [false] }) }));
    expectRejected(closed({ value: raw({ enum: [Number.NaN] }) }));
  });
});

describe("canonical proposal reference rejection", () => {
  test("reject unresolved, external, sibling-bearing, nested, and recursive references", () => {
    expectRejected(referencedRoot(Type.Ref("#/$defs/Missing")));
    expectRejected(referencedRoot(raw({ $ref: "https://example.test/schema" })));
    expectRejected(
      referencedRoot(raw({ $ref: "#/$defs/Value", description: "sibling" }), {
        Value: Type.String(),
      }),
    );
    expectRejected(
      referencedRoot(
        raw({
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
          $defs: {},
        }),
      ),
    );
    expectRejected(referencedRoot(Type.Ref("#/$defs/A"), { A: Type.Ref("#/$defs/A") }));
    expectRejected(
      referencedRoot(Type.Ref("#/$defs/A"), {
        A: Type.Ref("#/$defs/B"),
        B: Type.Ref("#/$defs/A"),
      }),
    );
  });

  test("inspect description-named branches and require own definition membership", () => {
    expectRejected(
      raw({
        type: "object",
        properties: { description: { $ref: "#/$defs/Missing" } },
        required: ["description"],
        additionalProperties: false,
      }),
    );
    expectRejected(
      referencedRoot(Type.Ref("#/$defs/A"), {
        A: raw({
          type: "object",
          properties: { description: { $ref: "#/$defs/A" } },
          required: ["description"],
          additionalProperties: false,
        }),
      }),
    );
    expectRejected(
      referencedRoot(
        Type.String(),
        Object.fromEntries([["description", Type.Ref("#/$defs/Missing")]]),
      ),
    );
    expectRejected(referencedRoot(Type.Ref("#/$defs/toString")));
    expectRejected(referencedRoot(Type.Ref("#/$defs/valueOf")));

    const prototypeDefinition = Object.fromEntries([["toString", Type.String()]]);
    expect(
      createProposalDefinition(
        "OwnPrototypeName",
        referencedRoot(Type.Ref("#/$defs/toString"), prototypeDefinition),
      ).proposal_schema.name,
    ).toBe("OwnPrototypeName");
  });
});
