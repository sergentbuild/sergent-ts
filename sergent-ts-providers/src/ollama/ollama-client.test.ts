import { describe, expect, test } from "bun:test";
import {
  Type,
  createMessages,
  createModelRequest,
  createModelSettings,
  createPngImage,
  createProposalDefinition,
  createSystemMessage,
  createUserMessage,
} from "sergent-ts-core";
import type { ModelTokens } from "sergent-ts-core";
import { createOllamaModelClient } from "./index.js";
import { ollamaRequest } from "./request.js";
import providerManifest from "../../package.json" with { type: "json" };

/** Constructs one complete portable request for Ollama translation tests. */
function request(modelName = "ollama/team/model", effort: "low" | "medium" | "high" = "medium") {
  const proposal = createProposalDefinition(
    "AnswerProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  const messages = createMessages(
    [createUserMessage("question", [createPngImage(new Uint8Array([10, 11, 12]))])],
    createSystemMessage("system"),
  );
  return createModelRequest(
    modelName,
    messages,
    proposal.proposal_schema,
    createModelSettings(144, 400, effort),
  );
}

/** Creates a complete native Ollama JSON response. */
function response(rawResponse = '{"answer":"yes"}', overrides: Record<string, unknown> = {}) {
  return {
    model: "team/model",
    created_at: "2026-09-01T00:00:00Z",
    message: { role: "assistant", content: rawResponse },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 6,
    eval_count: 3,
    ...overrides,
  };
}

/** Creates a hermetic fetch function with Bun's preconnect surface. */
function fetchWith(
  handler: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: () => undefined });
}

/** Returns an application/json response for the SDK-shaped fetch seam. */
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Reads the string request body emitted by the official SDK. */
function requestBody(init?: Parameters<typeof fetch>[1]): string {
  if (typeof init?.body !== "string") throw new TypeError("Expected a string request body");
  return init.body;
}

/** Narrows one parsed SDK request body to a JSON object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses the hermetic SDK request body for mapping assertions. */
function parsedRequest(init?: Parameters<typeof fetch>[1]): Record<string, unknown> {
  const value: unknown = JSON.parse(requestBody(init));
  if (!isObject(value)) throw new TypeError("Expected an object request body");
  return value;
}

/** Returns the URL from any fetch input accepted by the official SDK. */
function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

describe("Ollama provider adapter", () => {
  test("maps schema, messages, settings, endpoint, and evidence exactly", async () => {
    let url = "";
    let nativeBody: Record<string, unknown> | undefined;
    let nativeSignal: AbortSignal | null | undefined;
    const hermeticFetch = fetchWith(async (input, init) => {
      url = requestUrl(input);
      nativeBody = parsedRequest(init);
      nativeSignal = init?.signal;
      return jsonResponse(response());
    });
    const portable = request();
    const semanticBody = ollamaRequest(portable, "team/model");
    expect(semanticBody.format).toBe(portable.proposalSchema.json_schema);
    const host = "http://ollama-success-secret.test:11434";
    const outcome = await createOllamaModelClient({
      host,
      fetch: hermeticFetch,
    }).invoke(portable, new AbortController().signal);

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success" || nativeBody === undefined) {
      throw new Error("Expected one captured Ollama success");
    }
    expect(url).toBe(`${host}/api/chat`);
    expect(nativeBody).toMatchObject({
      model: "team/model",
      format: portable.proposalSchema.json_schema,
      think: true,
      stream: false,
      options: { num_predict: 144 },
    });
    expect(nativeBody.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "question", images: ["CgsM"] },
    ]);
    expect(nativeSignal).toBeInstanceOf(AbortSignal);
    expect(outcome.identity).toEqual({
      provider: "ollama",
      model: "team/model",
      sdkPackage: "ollama",
      sdkVersion: providerManifest.dependencies.ollama,
    });
    expect(outcome.usage.tokens).toEqual({ input: 6, output: 3 });
    expect(outcome.usage.requestId).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(host);
  });
});

describe("Ollama provider adapter settings and retry", () => {
  test("maps low effort to false and medium or high effort to true", async () => {
    const values: boolean[] = [];
    const hermeticFetch = fetchWith(async (_input, init) => {
      const think = Reflect.get(parsedRequest(init), "think");
      if (typeof think !== "boolean") throw new TypeError("Expected a thinking flag");
      values.push(think);
      return jsonResponse(response());
    });
    for (const effort of ["low", "medium", "high"] as const) {
      const outcome = await createOllamaModelClient({ fetch: hermeticFetch }).invoke(
        request("ollama/model", effort),
        new AbortController().signal,
      );
      expect(outcome.status).toBe("success");
    }

    expect(values).toEqual([false, true, true]);
  });

  test("creates request-scoped clients and performs one immediate retry", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const bodies: string[] = [];
    let calls = 0;
    const hermeticFetch = fetchWith(async (_input, init) => {
      calls += 1;
      signals.push(init?.signal);
      bodies.push(requestBody(init));
      if (calls === 1) return jsonResponse({ error: "down" }, 500);
      return jsonResponse(response());
    });
    const outcome = await createOllamaModelClient({ fetch: hermeticFetch }).invoke(
      request("ollama/model"),
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    expect(calls).toBe(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(signals[1]).not.toBe(signals[0]);
  });
});

describe("Ollama reported token directions", () => {
  /** Optional native counters stay distinct from the portable expected mapping. */
  const cases: readonly {
    readonly prompt_eval_count: number | undefined;
    readonly eval_count: number | undefined;
    readonly expected: ModelTokens | null;
  }[] = [
    { prompt_eval_count: 0, eval_count: undefined, expected: { input: 0 } },
    { prompt_eval_count: undefined, eval_count: 0, expected: { output: 0 } },
    { prompt_eval_count: undefined, eval_count: undefined, expected: null },
  ];
  test.each([...cases])(
    "preserves exactly known counts: %j",
    async ({ prompt_eval_count, eval_count, expected }) => {
      const hermeticFetch = fetchWith(async () =>
        jsonResponse(response('{"answer":"yes"}', { prompt_eval_count, eval_count })),
      );
      const outcome = await createOllamaModelClient({ fetch: hermeticFetch }).invoke(
        request(),
        new AbortController().signal,
      );
      expect(outcome.status).toBe("success");
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.usage?.tokens).toEqual(expected);
    },
  );
});

describe("Ollama provider adapter admission and status", () => {
  test("maps HTTP status and does not retry terminal model absence", async () => {
    let calls = 0;
    const hermeticFetch = fetchWith(async () => {
      calls += 1;
      return jsonResponse({ error: "missing" }, 404);
    });
    const outcome = await createOllamaModelClient({ fetch: hermeticFetch }).invoke(
      request("ollama/model"),
      new AbortController().signal,
    );

    expect(calls).toBe(1);
    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("model_not_found");
  });

  test("rejects truncation and malformed response text with reached evidence", async () => {
    const cases = [response(undefined, { done_reason: "length" }), response("not-json")];
    for (const nativeResponse of cases) {
      const hermeticFetch = fetchWith(async () => jsonResponse(nativeResponse));
      const outcome = await createOllamaModelClient({ fetch: hermeticFetch }).invoke(
        request("ollama/model"),
        new AbortController().signal,
      );
      expect(outcome.status).toBe("failure");
      if (outcome.status !== "failure") throw new Error("Expected failure");
      expect(outcome.error.kind).toBe("invalid_response");
      expect(outcome.rawResponse).not.toBeNull();
    }
  });
});

describe("Ollama provider adapter selection and SDK policy", () => {
  test("rejects blank host and model selection before fetch", async () => {
    let calls = 0;
    const hermeticFetch = fetchWith(async () => {
      calls += 1;
      return jsonResponse(response());
    });
    const host = await createOllamaModelClient({ host: " ", fetch: hermeticFetch }).invoke(
      request("ollama/model"),
      new AbortController().signal,
    );
    const selectionHost = "http://ollama-selection-secret.test:11434";
    const model = await createOllamaModelClient({
      host: selectionHost,
      fetch: hermeticFetch,
    }).invoke(request("google/model"), new AbortController().signal);

    expect(calls).toBe(0);
    if (host.status !== "failure" || model.status !== "failure") {
      throw new Error("Expected failures");
    }
    expect(host.error.kind).toBe("missing_credentials");
    expect(model.error.kind).toBe("invalid_model_name");
    expect(host.attempts).toHaveLength(0);
    expect(model.attempts).toHaveLength(0);
    expect(JSON.stringify(model)).not.toContain(selectionHost);
  });

  test("disables hidden SDK retries under repeated HTTP failures", async () => {
    let calls = 0;
    const hermeticFetch = fetchWith(async () => {
      calls += 1;
      return jsonResponse({ error: "down" }, 500);
    });
    const outcome = await createOllamaModelClient({ fetch: hermeticFetch }).invoke(
      request("ollama/model"),
      new AbortController().signal,
    );

    expect(outcome.status).toBe("failure");
    expect(calls).toBe(2);
    expect(outcome.attempts).toHaveLength(2);
  });
});
