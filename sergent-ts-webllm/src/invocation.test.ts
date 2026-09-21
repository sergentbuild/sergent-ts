import { expect, test } from "bun:test";
import type { ChatCompletion } from "@mlc-ai/web-llm/lib/openai_api_protocols/chat_completion.js";
import { ready, request, response, tokenUsage } from "./session-fixture.test.js";

test("healthy completions reset conversation and usage before each independent dispatch", async () => {
  const value = await ready();
  const reset = Promise.withResolvers<void>();
  value.engine.resetResult = reset.promise;
  const first = value.session.client.invoke(request(), new AbortController().signal);
  expect(value.session.state.kind).toBe("running");
  expect(() => value.session.client.invoke(request(), new AbortController().signal)).toThrow(
    TypeError,
  );
  value.clock.advance(4000);
  expect(value.engine.requests).toHaveLength(0);
  reset.resolve();
  const result = await first;
  expect(result.status).toBe("success");
  expect(result.attempts).toHaveLength(1);
  expect(result.attempts[0]?.timing.durationMs).toBe(0);
  expect(result.usage).toEqual({
    latencyMs: 4000,
    tokens: { input: 20, output: 8, total: 28 },
    requestId: "native-local-id",
  });
  expect(result.identity).toEqual({
    provider: "webllm",
    model: "local-test",
    sdkPackage: "@mlc-ai/web-llm",
    sdkVersion: "0.2.84",
  });
  await value.session.client.invoke(request(), new AbortController().signal);
  expect(value.engine.resets).toEqual([
    [false, "local-test"],
    [false, "local-test"],
  ]);
  expect(value.engine.requests).toHaveLength(2);
  expect(value.session.state.kind).toBe("ready");
  value.session.close();
});

test("reported zero output remains reached usage after semantic rejection", async () => {
  const value = await ready();
  value.engine.completionResult = Promise.resolve({ ...response(""), usage: tokenUsage(20, 0) });
  const result = await value.session.client.invoke(request(), new AbortController().signal);
  expect(result.status).toBe("failure");
  expect(result.attempts).toHaveLength(1);
  expect(result.rawResponse).toBe("");
  expect(result.usage?.tokens).toEqual({ input: 20, output: 0, total: 20 });
  expect(value.session.state.kind).toBe("ready");
  value.session.close();
});

test("already aborted invocation leaves the healthy worker and all native methods untouched", async () => {
  const value = await ready();
  const result = await value.session.client.invoke(request(), AbortSignal.abort());
  expect(result.status).toBe("cancelled");
  expect(result.attempts).toHaveLength(0);
  expect(value.engine.resets).toHaveLength(0);
  expect(value.worker.terminations).toBe(0);
  expect(value.session.state.kind).toBe("ready");
  value.session.close();
});

test.each(["reset", "generation"] as const)(
  "abort during %s settles parked work with no interrupted evidence",
  async (phase) => {
    const value = await ready();
    const gate = Promise.withResolvers<void>();
    const completion = Promise.withResolvers<ChatCompletion>();
    if (phase === "reset") value.engine.resetResult = gate.promise;
    else value.engine.completionResult = completion.promise;
    const controller = new AbortController();
    const pending = value.session.client.invoke(request(), controller.signal);
    await (phase === "reset"
      ? value.engine.resetEntered.promise
      : value.engine.completionEntered.promise);
    controller.abort();
    expect(value.worker.terminations).toBe(1);
    expect(value.session.state.kind).toBe("unavailable");
    const outcome = await pending;
    expect(
      value.diagnostics.filter((event) => event.event === "invocation_cancelled"),
    ).toHaveLength(1);
    expect(value.diagnostics.filter((event) => event.event === "worker_disposed")).toHaveLength(1);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.attempts).toHaveLength(0);
    expect(outcome.rawResponse).toBeNull();
    expect(outcome.usage).toBeNull();
    gate.resolve();
    completion.resolve(response());
    await Promise.all([gate.promise, completion.promise]);
    value.clock.advance(6000);
    expect(value.engine.requests).toHaveLength(phase === "reset" ? 0 : 1);
    expect(() => value.session.client.invoke(request(), new AbortController().signal)).toThrow(
      TypeError,
    );
    value.session.close();
    expect(value.worker.terminations).toBe(1);
  },
);

test.each(["reject", "timeout", "late"] as const)(
  "reset %s produces the zero-attempt session-unavailable failure",
  async (action) => {
    const value = await ready();
    const gate = Promise.withResolvers<void>();
    value.engine.resetResult = gate.promise;
    const pending = value.session.client.invoke(request(), new AbortController().signal);
    if (action === "reject") gate.reject(new Error("timeout rate limit"));
    else value.clock.advance(5000, action !== "late");
    if (action === "late") gate.resolve();
    const result = await pending;
    expect(result.status).toBe("failure");
    expect(
      value.diagnostics.some(
        (event) => event.event === (action === "reject" ? "reset_failed" : "reset_timeout"),
      ),
    ).toBe(true);
    if (result.status !== "failure") throw new Error("Expected reset failure");
    expect(result.error.kind).toBe("invalid_payload");
    expect(result.error.metadata.reason).toBe("session_unavailable");
    expect(result.attempts).toHaveLength(0);
    expect(value.engine.requests).toHaveLength(0);
    expect(value.worker.terminations).toBe(1);
  },
);

test.each(["timeout", "worker", "native", "close"] as const)(
  "%s settles a dispatched parked completion exactly once without retry",
  async (action) => {
    const value = await ready();
    const gate = Promise.withResolvers<ChatCompletion>();
    value.engine.completionResult = gate.promise;
    const controller = new AbortController();
    const pending = value.session.client.invoke(request(), controller.signal);
    await value.engine.completionEntered.promise;
    if (action === "timeout") value.clock.advance(100);
    if (action === "worker") value.worker.dispatchEvent(new Event("error"));
    if (action === "native") gate.reject(new Error("timeout unavailable secret"));
    if (action === "close") value.session.close();
    const result = await pending;
    controller.abort();
    expect(
      value.diagnostics.some(
        (event) =>
          event.event ===
          (action === "timeout"
            ? "completion_timeout"
            : action === "close"
              ? "session_closed"
              : action === "worker"
                ? "worker_failure"
                : "completion_failed"),
      ),
    ).toBe(true);
    expect(value.worker.terminations).toBe(1);
    expect(value.engine.requests).toHaveLength(1);
    expect(result.attempts).toHaveLength(action === "close" ? 0 : 1);
    if (result.status === "failure")
      expect(result.error.kind).toBe(
        action === "worker"
          ? "provider_unavailable"
          : action === "native"
            ? "provider_error"
            : "timeout",
      );
    else expect(result.status).toBe("cancelled");
    gate.resolve(response());
    await gate.promise.catch(() => undefined);
    expect(value.session.state.kind).toBe(action === "close" ? "closed" : "unavailable");
  },
);

test.each(["response", "rejection"] as const)(
  "elapsed dispatch deadline arbitrates late %s and preserves only reached facts",
  async (arrival) => {
    const value = await ready();
    const gate = Promise.withResolvers<ChatCompletion>();
    value.engine.completionResult = gate.promise;
    const pending = value.session.client.invoke(request(), new AbortController().signal);
    await value.engine.completionEntered.promise;
    value.clock.advance(101, false);
    if (arrival === "response") gate.resolve(response());
    else gate.reject(new Error("native failure after deadline"));
    const outcome = await pending;
    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected timeout");
    expect(outcome.error.kind).toBe("timeout");
    expect(outcome.attempts[0]?.retryable).toBe(true);
    expect(outcome.rawResponse).toBe(arrival === "response" ? '{"text":"Fixed."}' : null);
    expect(outcome.parsedJson).toEqual(arrival === "response" ? { text: "Fixed." } : null);
    expect(outcome.usage?.latencyMs ?? null).toBe(arrival === "response" ? 101 : null);
    expect(value.worker.terminations).toBe(1);
  },
);
