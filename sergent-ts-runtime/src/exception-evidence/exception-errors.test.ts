import { describe, expect, test } from "bun:test";
import type { RunObserver } from "sergent-ts-observability";

import { observerDeliveryError, runtimeInternalError } from "./index.js";

/** Creates one inert observer whose native type remains visible to evidence projection. */
function testObserver(): RunObserver {
  return {
    progress(): undefined {
      return undefined;
    },
    finished(): undefined {
      return undefined;
    },
  };
}

describe("runtime thrown-value evidence", () => {
  test("projects observer callback failures with their exact metadata", () => {
    const error = observerDeliveryError(
      "progress",
      testObserver(),
      new Error("progress failed"),
      "commit",
    );

    expect(error.kind).toBe("observer_error");
    expect(error.metadata).toEqual({
      callback: "progress",
      observer_type: "Object",
      exception_type: "Error",
      stage: "commit",
    });
    expect(error.message).toContain("progress failed");
  });

  test("keeps distinct fallbacks when thrown message access fails", () => {
    const hostile = new Error("hidden");
    Object.defineProperty(hostile, "message", {
      get(): never {
        throw new Error("message access failed");
      },
    });

    const observer = observerDeliveryError("finished", testObserver(), hostile, "intent");
    const internal = runtimeInternalError(hostile, "intent");

    expect(observer.kind).toBe("observer_error");
    expect(internal.kind).toBe("internal_error");
    expect(observer.message.toLowerCase()).toContain("unrenderable");
    expect(internal.message.toLowerCase()).toContain("unrenderable");
  });

  test("projects internal traceback, cause, type, and step evidence", () => {
    const cause = new Error("inner failure");
    const reason = new Error("outer failure");
    Object.defineProperty(reason, "cause", { value: cause });
    const frames = Array.from({ length: 25 }, (_value, index) => `frame ${index}`);
    Object.defineProperty(reason, "stack", { value: frames.join("\n") });

    const error = runtimeInternalError(reason, "execution_plan");

    expect(error.kind).toBe("internal_error");
    expect(error.metadata).toEqual({
      exception_type: "Error",
      traceback: frames.slice(-20).join("\n"),
      cause_chain: [{ exception_type: "Error", message: "inner failure" }],
      current_step: "execution_plan",
    });
    expect(error.message).toContain("outer failure");
  });
});
