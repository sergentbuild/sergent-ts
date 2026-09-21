import { describe, expect, test } from "bun:test";

import {
  createExecutionPlan,
  createMessages,
  createModelRequest,
  createModelSettings,
  createPngImage,
  createProposalDefinition,
  createSystemMessage,
  createUserMessage,
  Type,
} from "sergent-ts-core";
import type { PlanStep } from "sergent-ts-core";

import type { CapturedValue } from "../records/index.js";
import {
  captureModelRequest,
  captureValue,
  createPatchSummary,
  executionPlanEvidence,
  projectModelMessage,
  projectPatchSummary,
  projectSchemaObject,
} from "./index.js";

/** Compile-time proof that a capture error cannot carry captured-state fields. */
type InvalidCaptureStateAssignable =
  Readonly<{
    value: null;
    value_type: string;
    error: null;
    status: "capture_error";
  }> extends CapturedValue
    ? true
    : false;

const INVALID_CAPTURE_STATE_ASSIGNABLE: InvalidCaptureStateAssignable = false;

/** Stable framework identity used by capture projections. */
const BASE = Object.freeze({
  scene_id: "scene_00000000000000000000000000000000" as const,
  revision: 4,
});

/** Stable operation IDs used by aligned Patch evidence. */
const FIRST_OPERATION_ID = "op_00000000000000000000000000000001" as const;
const SECOND_OPERATION_ID = "op_00000000000000000000000000000002" as const;

/** Creates one exact portable request fixture. */
function modelRequest() {
  const proposal = createProposalDefinition(
    "CaptureProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  const messages = createMessages(
    [createUserMessage("look", [createPngImage(new Uint8Array([1, 2, 3]))])],
    createSystemMessage("system"),
  );
  return createModelRequest(
    "provider/model",
    messages,
    proposal.proposal_schema,
    createModelSettings(128, 5000, "medium"),
  );
}

/** Application-shaped concrete value whose own fields must survive capture. */
class ConcreteValue {
  public readonly inherited = "kept";
  public readonly nested = Object.freeze({ count: 2 });
}

describe("captured values", () => {
  test("projects concrete fields and degrades unsupported leaves", () => {
    const captured = captureValue({
      concrete: new ConcreteValue(),
      unsupported: new Map([["key", "value"]]),
      nonfinite: Number.POSITIVE_INFINITY,
    });

    expect(captured).toEqual({
      value: {
        concrete: { inherited: "kept", nested: { count: 2 } },
        unsupported: { type: "Map", repr: "[object Map]" },
        nonfinite: { type: "number", repr: "Infinity" },
      },
      value_type: "Object",
      error: null,
      status: "captured",
    });
  });

  test("contains cycles and throwing property access as capture errors", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const throwing = Object.defineProperty({}, "bad", {
      enumerable: true,
      get: (): never => {
        throw new Error("getter failed");
      },
    });

    expect(captureValue(cyclic)).toMatchObject({
      value: null,
      value_type: "Object",
      status: "capture_error",
      error: { kind: "capture_error", metadata: { value_type: "Object" } },
    });
    expect(captureValue(throwing)).toMatchObject({
      value: null,
      status: "capture_error",
      error: { message: "Failed to capture value: getter failed" },
    });
    expect(captureValue(null)).toEqual({
      value: null,
      value_type: "null",
      error: null,
      status: "captured",
    });
    expect(INVALID_CAPTURE_STATE_ASSIGNABLE).toBe(false);
  });

  test("preserves own enumerable prototype-named fields", () => {
    const source: Record<string, unknown> = {};
    Object.defineProperty(source, "__proto__", {
      value: Object.freeze({ kept: true }),
      enumerable: true,
    });
    const captured = captureValue(source);
    if (captured.status !== "captured") throw new Error("Expected successful capture");
    if (typeof captured.value !== "object" || captured.value === null) {
      throw new Error("Expected an object projection");
    }
    expect(Object.hasOwn(captured.value, "__proto__")).toBe(true);
    expect(Reflect.get(captured.value, "__proto__")).toEqual({ kept: true });
  });
});

describe("owned framework projections", () => {
  test("captures request, messages, and image byte counts without schema or image data", () => {
    const request = modelRequest();
    expect(captureModelRequest(request).value).toEqual({
      model_name: "provider/model",
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "look", images: [{ media_type: "image/png", bytes: 3 }] },
      ],
      model_settings: {
        maxOutputTokens: 128,
        timeoutMs: 5000,
        thinkingEffort: "medium",
      },
    });
    expect(projectModelMessage(createUserMessage("text only"))).toEqual({
      role: "user",
      content: "text only",
    });
  });

  test("projects plans without bookkeeping IDs and patches with aligned trace evidence", () => {
    const firstOperation = Object.freeze({ call: "replace", value: "new" });
    const secondOperation = Object.freeze({ call: "append", value: "tail" });
    const steps: readonly PlanStep[] = Object.freeze([
      Object.freeze({
        op_id: FIRST_OPERATION_ID,
        operation: firstOperation,
      }),
      Object.freeze({
        op_id: SECOND_OPERATION_ID,
        operation: secondOperation,
      }),
    ]);
    const plan = createExecutionPlan(BASE, Object.freeze({ flow: "continue" }), steps);
    const patch = Object.freeze({ base: BASE, steps });

    expect(captureValue(executionPlanEvidence(plan)).value).toEqual({
      base: BASE,
      steps: [
        { call: "replace", value: "new" },
        { call: "append", value: "tail" },
      ],
    });
    expect(createPatchSummary(patch)).toEqual({
      base: BASE,
      operation_count: 2,
      operation_ids: [FIRST_OPERATION_ID, SECOND_OPERATION_ID],
      operation_call_names: ["replace", "append"],
      operation_trace_ids: [FIRST_OPERATION_ID, SECOND_OPERATION_ID],
      operations: [captureValue(firstOperation), captureValue(secondOperation)],
    });
    expect(projectPatchSummary(patch)).toMatchObject({
      operation_count: 2,
      operation_ids: [FIRST_OPERATION_ID, SECOND_OPERATION_ID],
      operation_trace_ids: [FIRST_OPERATION_ID, SECOND_OPERATION_ID],
    });
  });
});

describe("canonical schema projection", () => {
  test("preserves prototype-named fields in canonical schema projection", () => {
    const properties: Record<string, unknown> = {};
    Object.defineProperty(properties, "__proto__", {
      value: Object.freeze({ type: "string" }),
      enumerable: true,
    });
    const projected = projectSchemaObject({
      type: "object",
      properties,
      additionalProperties: false,
    });
    const projectedProperties = projected.properties;
    if (
      typeof projectedProperties !== "object" ||
      projectedProperties === null ||
      Array.isArray(projectedProperties)
    ) {
      throw new Error("Expected projected schema properties");
    }
    expect(Object.hasOwn(projectedProperties, "__proto__")).toBe(true);
    expect(Reflect.get(projectedProperties, "__proto__")).toEqual({ type: "string" });
  });
});
