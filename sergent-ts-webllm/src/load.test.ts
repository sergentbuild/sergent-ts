import { expect, test } from "bun:test";
import { fixture, PROFILE } from "./session-fixture.test.js";

test("one-shot load retains progress and overrides despite throwing notifications", async () => {
  const value = fixture(undefined, () => {
    throw new Error("display failed");
  });
  const gate = Promise.withResolvers<void>();
  value.engine.reloadResult = gate.promise;
  expect(value.session.state.kind).toBe("cold");
  const loading = value.session.load(new AbortController().signal);
  await value.engine.reloadEntered.promise;
  const report = { progress: 0.4, timeElapsed: 3, text: "Downloading weights" };
  value.progress(report);
  report.text = "changed later";
  expect(value.session.state).toEqual({
    kind: "loading",
    progress: { ...report, text: "Downloading weights" },
  });
  gate.resolve();
  expect(await loading).toEqual({ status: "ready" });
  expect(value.engine.loadOptions).toEqual({
    context_window_size: PROFILE.contextWindowSize,
    max_history_size: PROFILE.maxHistorySize,
    conv_config: {
      stop_token_ids: [...PROFILE.stopTokenIds],
      role_empty_sep: PROFILE.roleEmptySeparator,
    },
  });
  expect(value.session.state.kind).toBe("ready");
  expect(() => value.session.load(new AbortController().signal)).toThrow(TypeError);
  value.session.close();
  value.session.close();
  expect(value.worker.terminations).toBe(1);
});

test("failed capability probe prevents engine creation and download", async () => {
  const value = fixture(() => Promise.resolve("webgpu_unavailable"));
  expect(await value.session.load(new AbortController().signal)).toEqual({
    status: "unavailable",
    reason: "webgpu_unavailable",
  });
  expect(value.engine.loadOptions).toBeNull();
  expect(value.worker.terminations).toBe(0);
});

test("load cancellation during a parked probe settles without creating a worker", async () => {
  const gate = Promise.withResolvers<null>();
  const value = fixture(() => gate.promise);
  const controller = new AbortController();
  const loading = value.session.load(controller.signal);
  controller.abort();
  expect(value.session.state.kind).toBe("unavailable");
  expect(await loading).toEqual({ status: "cancelled" });
  gate.resolve(null);
  await gate.promise;
  expect(value.engine.loadOptions).toBeNull();
});

test.each(["cancel", "close", "timeout", "worker", "reject"] as const)(
  "%s settles a parked native load by immediate disposal",
  async (action) => {
    const value = fixture();
    const gate = Promise.withResolvers<void>();
    value.engine.reloadResult = gate.promise;
    const controller = new AbortController();
    const loading = value.session.load(controller.signal);
    await value.engine.reloadEntered.promise;
    if (action === "cancel") controller.abort();
    if (action === "close") value.session.close();
    if (action === "timeout") value.clock.advance(1000);
    if (action === "worker") value.worker.dispatchEvent(new Event("messageerror"));
    if (action === "reject") gate.reject(new Error("native secret"));
    const result = await loading;
    expect(
      value.diagnostics.some(
        (event) =>
          event.event ===
          (action === "timeout"
            ? "load_timeout"
            : action === "cancel" || action === "close"
              ? "load_cancelled"
              : "load_failed"),
      ),
    ).toBe(true);
    expect(result.status).toBe(
      action === "cancel" || action === "close" ? "cancelled" : "unavailable",
    );
    expect(value.worker.terminations).toBe(1);
    expect(value.session.state.kind).toBe(action === "close" ? "closed" : "unavailable");
    gate.resolve();
    await gate.promise.catch(() => undefined);
    value.progress({ progress: 1, timeElapsed: 9, text: "late completion" });
    expect(value.session.state.kind).toBe(action === "close" ? "closed" : "unavailable");
    expect(JSON.stringify(result)).not.toContain("native secret");
  },
);

test("elapsed load deadline rejects a response before delayed timer delivery", async () => {
  const value = fixture();
  const gate = Promise.withResolvers<void>();
  value.engine.reloadResult = gate.promise;
  const loading = value.session.load(new AbortController().signal);
  await value.engine.reloadEntered.promise;
  value.clock.advance(1001, false);
  gate.resolve();
  expect(await loading).toEqual({ status: "unavailable", reason: "load_timeout" });
  expect(value.worker.terminations).toBe(1);
});
