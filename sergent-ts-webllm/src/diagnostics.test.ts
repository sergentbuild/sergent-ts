import { expect, test } from "bun:test";
import type { ChatCompletion } from "@mlc-ai/web-llm/lib/openai_api_protocols/chat_completion.js";
import { fixture, request, response } from "./session-fixture.test.js";

test("native diagnostics distinguish parked reset and completion, then report safe reached admission metadata", async () => {
  const value = fixture();
  await value.session.load(new AbortController().signal);
  expect(value.diagnostics.map((event) => event.event)).toEqual([
    "load_start",
    "probe_start",
    "probe_complete",
    "worker_created",
    "model_load_start",
    "model_load_complete",
    "load_ready",
  ]);
  const reset = Promise.withResolvers<void>();
  const completion = Promise.withResolvers<ChatCompletion>();
  value.engine.resetResult = reset.promise;
  value.engine.completionResult = completion.promise;
  const pending = value.session.client.invoke(request(), new AbortController().signal);
  expect(value.diagnostics.at(-1)).toMatchObject({ event: "reset_start", timeoutMs: 5000 });
  value.clock.advance(4000);
  reset.resolve();
  await value.engine.completionEntered.promise;
  expect(value.diagnostics.at(-1)).toMatchObject({
    event: "completion_dispatch",
    timeoutMs: 100,
    elapsedMs: 4000,
  });
  value.clock.advance(50);
  completion.resolve(response('{"text":"Private model text."}'));
  expect((await pending).status).toBe("success");
  expect(value.diagnostics.slice(-3).map((event) => event.event)).toEqual([
    "completion_received",
    "response_admission",
    "completion_success",
  ]);
  expect(value.diagnostics.at(-2)).toMatchObject({
    accepted: true,
    finishReason: "stop",
    tokens: { input: 20, output: 8, total: 28 },
    elapsedMs: 4050,
  });
  const serialized = JSON.stringify(value.diagnostics);
  expect(serialized).not.toContain("Private model text");
  expect(serialized).not.toContain("Fix this text");
  value.session.close();
  expect(value.diagnostics.slice(-2).map((event) => event.event)).toEqual([
    "session_closed",
    "worker_disposed",
  ]);
});

test("throwing diagnostic delivery cannot change timeout arbitration or dispose a worker twice", async () => {
  const value = fixture(undefined, undefined, () => {
    throw new Error("diagnostic sink failed");
  });
  expect((await value.session.load(new AbortController().signal)).status).toBe("ready");
  const completion = Promise.withResolvers<ChatCompletion>();
  value.engine.completionResult = completion.promise;
  const pending = value.session.client.invoke(request(), new AbortController().signal);
  await value.engine.completionEntered.promise;
  value.clock.advance(100);
  const result = await pending;
  expect(result.status).toBe("failure");
  expect(value.diagnostics.slice(-2).map((event) => event.event)).toEqual([
    "completion_timeout",
    "worker_disposed",
  ]);
  const count = value.diagnostics.length;
  completion.resolve(response());
  await completion.promise;
  expect(value.diagnostics).toHaveLength(count);
  expect(value.worker.terminations).toBe(1);
});
