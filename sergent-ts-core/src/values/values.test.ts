import { describe, expect, test } from "bun:test";

import {
  cancelledError,
  captureError,
  internalError,
  mergeConflictError,
  mintOperationId,
  mintRunId,
  observerError,
  patchValidationError,
  runError,
  schemaValidationError,
  stalePatchError,
  validationError,
  validationIssue,
} from "./index.js";

describe("framework values", () => {
  test("mint framework IDs with exact prefixes and random-byte grammar", () => {
    const runId = mintRunId();
    const operationId = mintOperationId();

    expect(runId).toMatch(/^run_[0-9a-f]{32}$/);
    expect(operationId).toMatch(/^op_[0-9a-f]{32}$/);
    expect(mintRunId()).not.toBe(runId);
    expect(mintOperationId()).not.toBe(operationId);
  });

  test("construct isolated metadata and bound human RunError prose", () => {
    const metadata = { nested: { value: "before" } };
    const error = runError("application_kind", "x".repeat(3000), metadata);
    metadata.nested.value = "after";

    expect(error.kind).toBe("application_kind");
    expect(Array.from(error.message)).toHaveLength(2048);
    expect(error.metadata).toEqual({ nested: { value: "before" } });
  });

  test("construct every living reserved framework error kind", () => {
    const cases = [
      captureError("capture", "Thing"),
      observerError("observer", { callback: "progress" }),
      cancelledError("cancelled"),
      validationError("validation", { index: 0 }),
      schemaValidationError("schema"),
      mergeConflictError("merge", { base_revision: 1 }),
      stalePatchError("stale", 2, 3),
      patchValidationError("patch"),
      internalError("internal", { current_step: null }),
    ];

    expect(cases.map((error) => error.kind)).toEqual([
      "capture_error",
      "observer_error",
      "cancelled",
      "validation_error",
      "schema_validation_failed",
      "merge_conflict",
      "stale_patch",
      "patch_validation",
      "internal_error",
    ]);
    expect(cases[0]?.metadata).toEqual({ value_type: "Thing" });
    expect(cases[6]?.metadata).toEqual({ base_revision: 2, current_revision: 3 });
  });

  test("isolate application validation issue metadata", () => {
    const metadata = { reason: "first" };
    const issue = validationIssue("domain_rule", "Rejected", metadata);
    metadata.reason = "changed";

    expect(issue).toEqual({
      kind: "domain_rule",
      message: "Rejected",
      metadata: { reason: "first" },
    });
  });
});
