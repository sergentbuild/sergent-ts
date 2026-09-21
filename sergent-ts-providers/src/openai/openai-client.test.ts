import { describe, expect, test } from "bun:test";
import { APIConnectionError, APIError } from "openai";
import { createOpenAIModelClient } from "./index.js";
import { request, response } from "./openai-fixtures.test.js";
import type {
  OpenAINativeClient,
  OpenAIRequest,
  OpenAIRequestOptions,
  OpenAIResponse,
} from "./native.js";

/** Creates an HTTP response envelope consumed by the real OpenAI SDK parser. */
function officialEnvelope(output: unknown): Readonly<Record<string, unknown>> {
  return {
    id: "response-1",
    object: "response",
    created_at: 1,
    status: "completed",
    error: null,
    incomplete_details: null,
    model: "org/model",
    output,
    usage: { input_tokens: 7, output_tokens: 4, total_tokens: 11 },
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

describe("OpenAI provider adapter", () => {
  test("maps native schema, settings, messages, and success evidence exactly", async () => {
    let body: OpenAIRequest | undefined;
    let options: OpenAIRequestOptions | undefined;
    const native: OpenAINativeClient = {
      responses: {
        create: async (nextBody, nextOptions) => {
          body = nextBody;
          options = nextOptions;
          return response();
        },
      },
    };
    const portable = request();
    const secret = "openai-success-secret";
    const outcome = await createOpenAIModelClient({ apiKey: secret, client: native }).invoke(
      portable,
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success" || body === undefined || options === undefined) {
      throw new Error("Expected one captured OpenAI success");
    }
    expect(body.model).toBe("org/model");
    expect(body.instructions).toBe("system");
    expect(body.max_output_tokens).toBe(128);
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "first" },
          { type: "input_image", detail: "auto", image_url: "data:image/png;base64,AQ==" },
          { type: "input_image", detail: "auto", image_url: "data:image/png;base64,Ag==" },
        ],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: "second" },
          { type: "input_image", detail: "auto", image_url: "data:image/png;base64,Aw==" },
          { type: "input_image", detail: "auto", image_url: "data:image/png;base64,BA==" },
        ],
      },
    ]);
    const format = body.text?.format;
    expect(format?.type).toBe("json_schema");
    if (format?.type !== "json_schema") throw new Error("Expected JSON schema format");
    expect(Object.is(format.schema, portable.proposalSchema.json_schema)).toBe(true);
    expect(options.maxRetries).toBe(0);
    expect(options.timeout).toBe(250);
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(outcome.identity).toEqual({
      provider: "openai",
      model: "org/model",
      sdkPackage: "openai",
      sdkVersion: "7.8.0",
    });
    expect(outcome.usage.tokens).toEqual({ input: 7, output: 4 });
    expect(outcome.usage.requestId).toBe("openai-request");
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });
});

describe("OpenAI thinking effort translation", () => {
  for (const effort of ["low", "medium", "high"] as const) {
    test(`maps ${effort} verbatim`, async () => {
      let body: OpenAIRequest | undefined;
      const native: OpenAINativeClient = {
        responses: {
          create: async (nextBody) => {
            body = nextBody;
            return response();
          },
        },
      };
      const outcome = await createOpenAIModelClient({ apiKey: "key", client: native }).invoke(
        request("openai/org/model", effort),
        new AbortController().signal,
      );

      expect(outcome.status).toBe("success");
      expect(body?.reasoning).toEqual({ effort });
    });
  }
});

describe("OpenAI provider adapter retry and classification", () => {
  test("reuses identical native data for the one immediate retry", async () => {
    const bodies: OpenAIRequest[] = [];
    const signals: AbortSignal[] = [];
    const native: OpenAINativeClient = {
      responses: {
        create: async (body, options) => {
          bodies.push(body);
          signals.push(options.signal);
          if (bodies.length === 1) {
            throw new APIConnectionError({ message: "connection" });
          }
          return response();
        },
      },
    };
    const outcome = await createOpenAIModelClient({ apiKey: "key", client: native }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(signals[1]).not.toBe(signals[0]);
  });

  test("classifies native status and envelope failures without retrying terminals", async () => {
    let calls = 0;
    const native: OpenAINativeClient = {
      responses: {
        create: async () => {
          calls += 1;
          throw APIError.generate(404, { error: { message: "missing" } }, "missing", new Headers());
        },
      },
    };
    const outcome = await createOpenAIModelClient({ apiKey: "secret", client: native }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(calls).toBe(1);
    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("model_not_found");
    expect(outcome.error.message).not.toContain("secret");
  });
});

describe("OpenAI provider adapter rejection", () => {
  test("rejects incomplete, refused, and malformed semantic responses", async () => {
    const cases: OpenAIResponse[] = [
      { ...response(), status: "incomplete" },
      {
        ...response(),
        output: [
          {
            type: "message",
            content: [{ type: "refusal", refusal: "no" }],
          },
        ],
      },
      response("not-json"),
    ];
    for (const nativeResponse of cases) {
      const client: OpenAINativeClient = {
        responses: { create: async () => nativeResponse },
      };
      const outcome = await createOpenAIModelClient({ apiKey: "key", client }).invoke(
        request(),
        new AbortController().signal,
      );
      expect(outcome.status).toBe("failure");
      if (outcome.status !== "failure") throw new Error("Expected failure");
      expect(outcome.error.kind).toBe("invalid_response");
      expect(outcome.attempts).toHaveLength(1);
    }
  });

  test("rejects credentials and model selection before touching the SDK", async () => {
    let calls = 0;
    const native: OpenAINativeClient = {
      responses: {
        create: async () => {
          calls += 1;
          return response();
        },
      },
    };
    const missing = await createOpenAIModelClient({ apiKey: " ", client: native }).invoke(
      request(),
      new AbortController().signal,
    );
    const selectionSecret = "openai-selection-secret";
    const invalid = await createOpenAIModelClient({
      apiKey: selectionSecret,
      client: native,
    }).invoke(request("anthropic/model"), new AbortController().signal);

    expect(calls).toBe(0);
    expect(missing.status).toBe("failure");
    expect(invalid.status).toBe("failure");
    if (missing.status !== "failure" || invalid.status !== "failure") {
      throw new Error("Expected pre-attempt failures");
    }
    expect(missing.error.kind).toBe("missing_credentials");
    expect(invalid.error.kind).toBe("invalid_model_name");
    expect(missing.attempts).toHaveLength(0);
    expect(invalid.attempts).toHaveLength(0);
    expect(JSON.stringify(invalid)).not.toContain(selectionSecret);
  });
});

describe("OpenAI provider adapter SDK policy", () => {
  test("disables hidden SDK retries under repeated HTTP failures", async () => {
    let fetchCalls = 0;
    const hermeticFetch = fetchWith(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ error: { message: "down", type: "server_error" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    const outcome = await createOpenAIModelClient({ apiKey: "key", fetch: hermeticFetch }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(outcome.status).toBe("failure");
    expect(fetchCalls).toBe(2);
    expect(outcome.attempts).toHaveLength(2);
  });
});

describe("OpenAI official SDK response handling", () => {
  test("derives semantic text from a native message content envelope", async () => {
    let fetchCalls = 0;
    const nativeMessage = {
      id: "message-1",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: '{"answer":"official"}',
          annotations: [],
          logprobs: [],
        },
      ],
    };
    const hermeticFetch = fetchWith(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(officialEnvelope([nativeMessage])), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "official-request" },
      });
    });
    const outcome = await createOpenAIModelClient({ apiKey: "key", fetch: hermeticFetch }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(fetchCalls).toBe(1);
    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") throw new Error("Expected success");
    expect(outcome.rawResponse).toBe('{"answer":"official"}');
    expect(outcome.parsedJson).toEqual({ answer: "official" });
    expect(outcome.usage.requestId).toBe("official-request");
  });

  test("rejects SDK response-processing TypeError without retry or invented evidence", async () => {
    let fetchCalls = 0;
    const hermeticFetch = fetchWith(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(officialEnvelope(null)), {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "unreached-request" },
      });
    });
    const outcome = await createOpenAIModelClient({ apiKey: "key", fetch: hermeticFetch }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(fetchCalls).toBe(1);
    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("invalid_response");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.rawResponse).toBeNull();
    expect(outcome.parsedJson).toBeNull();
    expect(outcome.usage).toBeNull();
  });
});

describe("OpenAI official SDK response body failures", () => {
  test("retries a failed HTTP-200 body read as provider unavailable", async () => {
    let fetchCalls = 0;
    const hermeticFetch = fetchWith(async () => {
      fetchCalls += 1;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => controller.error(new TypeError("body read failed")),
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const outcome = await createOpenAIModelClient({ apiKey: "key", fetch: hermeticFetch }).invoke(
      request(),
      new AbortController().signal,
    );
    expect(fetchCalls).toBe(2);
    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("provider_unavailable");
    expect(outcome.attempts.map((attempt) => attempt.error?.kind)).toEqual([
      "provider_unavailable",
      "provider_unavailable",
    ]);
    expect(outcome.rawResponse).toBeNull();
    expect(outcome.parsedJson).toBeNull();
    expect(outcome.usage).toBeNull();
  });
});
