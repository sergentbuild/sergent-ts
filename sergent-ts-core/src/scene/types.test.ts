import { describe, expect, test } from "bun:test";

import type { OperationId } from "../values/index.js";
import { runError, validationIssue } from "../values/index.js";
import { applied, operationFault, rebaseConflict, rebased, verificationReport } from "./index.js";

describe("Scene seam result construction", () => {
  test("construct application and conflict results without changing their facts", () => {
    const scene = { value: "after" };
    const error = runError("application_fault", "Apply failed");
    const operationId: OperationId = "op_00000000000000000000000000000000";

    expect(applied(scene)).toEqual({ ok: true, scene });
    expect(operationFault(operationId, error)).toEqual({
      ok: false,
      fault: { operation_id: operationId, error },
    });
    expect(rebaseConflict(error)).toEqual({ kind: "conflict", error });
  });

  test("isolate verification lists and rebase metadata at construction", () => {
    const issues = [validationIssue("domain", "Rejected")];
    const report = verificationReport(issues);
    issues.push(validationIssue("later", "Not retained"));
    const patch = {
      base: {
        scene_id: "scene_00000000000000000000000000000000" as const,
        revision: 4,
      },
      steps: [],
    };
    const metadata = { mapping: { reason: "before" } };
    const replacement = rebased(patch, metadata);
    metadata.mapping.reason = "after";

    expect(report.issues).toHaveLength(1);
    expect(replacement.patch).toBe(patch);
    expect(replacement.metadata).toEqual({ mapping: { reason: "before" } });
  });
});
