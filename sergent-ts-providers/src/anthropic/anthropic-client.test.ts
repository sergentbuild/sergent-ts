import { describe, expect, test } from "bun:test";
import { APIError } from "@anthropic-ai/sdk";
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
import { createAnthropicModelClient } from "./index.js";
import type {
  AnthropicNativeClient,
  AnthropicRequest,
  AnthropicRequestOptions,
  AnthropicResponse,
} from "./native.js";

/** Constructs one complete portable request for Anthropic translation tests. */
function request(
  modelName = "anthropic/claude-model",
  effort: "low" | "medium" | "high" = "medium",
) {
  const proposal = createProposalDefinition(
    "AnswerProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  const messages = createMessages(
    [
      createUserMessage("first", [
        createPngImage(new Uint8Array([4])),
        createPngImage(new Uint8Array([5])),
      ]),
      createUserMessage("second", [
        createPngImage(new Uint8Array([6])),
        createPngImage(new Uint8Array([7])),
      ]),
    ],
    createSystemMessage("system"),
  );
  return createModelRequest(
    modelName,
    messages,
    proposal.proposal_schema,
    createModelSettings(192, 300, effort),
  );
}

/** Creates a completed SDK-shaped Anthropic response. */
function response(rawParts = ['{"answer":', '"yes"}']): AnthropicResponse {
  return {
    content: rawParts.map((text) => ({ type: "text", text, citations: null })),
    stop_reason: "end_turn",
    stop_details: null,
    usage: {
      input_tokens: 3,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
      output_tokens: 4,
    },
    _request_id: "anthropic-request",
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

/** Exact ordered Anthropic multimodal translation expected from the fixture. */
const EXPECTED_MESSAGES: AnthropicRequest["messages"] = [
  {
    role: "user",
    content: [
      { type: "text", text: "first" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "BA==" },
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "BQ==" },
      },
    ],
  },
  {
    role: "user",
    content: [
      { type: "text", text: "second" },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "Bg==" },
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "Bw==" },
      },
    ],
  },
];

describe("Anthropic provider adapter", () => {
  test("maps native schema, thinking, messages, and evidence exactly", async () => {
    let body: AnthropicRequest | undefined;
    let options: AnthropicRequestOptions | undefined;
    const native: AnthropicNativeClient = {
      messages: {
        create: async (nextBody, nextOptions) => {
          body = nextBody;
          options = nextOptions;
          return response();
        },
      },
    };
    const portable = request();
    const secret = "anthropic-success-secret";
    const outcome = await createAnthropicModelClient({ apiKey: secret, client: native }).invoke(
      portable,
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success" || body === undefined || options === undefined) {
      throw new Error("Expected one captured Anthropic success");
    }
    expect(body.model).toBe("claude-model");
    expect(body.system).toBe("system");
    expect(body.max_tokens).toBe(192);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config?.effort).toBe("medium");
    expect(body.messages).toEqual(EXPECTED_MESSAGES);
    const format = body.output_config?.format;
    if (format?.type !== "json_schema") throw new Error("Expected JSON schema format");
    expect(Object.is(format.schema, portable.proposalSchema.json_schema)).toBe(true);
    expect(options).toMatchObject({ maxRetries: 0, timeout: 300 });
    expect(outcome.identity).toEqual({
      provider: "anthropic",
      model: "claude-model",
      sdkPackage: "@anthropic-ai/sdk",
      sdkVersion: "0.122.0",
    });
    expect(outcome.rawResponse).toBe('{"answer":"yes"}');
    expect(outcome.usage.tokens).toEqual({ input: 6, output: 4 });
    expect(outcome.usage.requestId).toBe("anthropic-request");
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });
});

describe("Anthropic thinking effort translation", () => {
  for (const effort of ["low", "medium", "high"] as const) {
    test(`maps ${effort} verbatim`, async () => {
      let body: AnthropicRequest | undefined;
      const native: AnthropicNativeClient = {
        messages: {
          create: async (nextBody) => {
            body = nextBody;
            return response();
          },
        },
      };
      const outcome = await createAnthropicModelClient({ apiKey: "key", client: native }).invoke(
        request("anthropic/claude-model", effort),
        new AbortController().signal,
      );

      expect(outcome.status).toBe("success");
      expect(body?.output_config?.effort).toBe(effort);
    });
  }
});

describe("Anthropic provider adapter retry and schema", () => {
  test("reuses identical native data for one retry and binds fresh signals", async () => {
    const bodies: AnthropicRequest[] = [];
    const signals: AbortSignal[] = [];
    const native: AnthropicNativeClient = {
      messages: {
        create: async (body, options) => {
          bodies.push(body);
          signals.push(options.signal);
          if (bodies.length === 1) throw new TypeError("connection");
          return response();
        },
      },
    };
    const outcome = await createAnthropicModelClient({ apiKey: "key", client: native }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(signals[1]).not.toBe(signals[0]);
  });

  test("rejects incompatible canonical schemas before SDK invocation", async () => {
    let calls = 0;
    const native: AnthropicNativeClient = {
      messages: {
        create: async () => {
          calls += 1;
          return response();
        },
      },
    };
    const proposal = createProposalDefinition(
      "BoundedProposal",
      Type.Object(
        { values: Type.Array(Type.String(), { maxItems: 2 }) },
        { additionalProperties: false },
      ),
    );
    const portable = request();
    const incompatible = createModelRequest(
      portable.modelName,
      portable.messages,
      proposal.proposal_schema,
      portable.modelSettings,
    );
    const outcome = await createAnthropicModelClient({ apiKey: "key", client: native }).invoke(
      incompatible,
      new AbortController().signal,
    );

    expect(calls).toBe(0);
    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("invalid_payload");
    expect(outcome.identity?.model).toBe("claude-model");
    expect(outcome.attempts).toHaveLength(0);
  });
});

describe("Anthropic provider adapter admission and evidence", () => {
  test("classifies terminal API status and rejects non-natural completion", async () => {
    let calls = 0;
    const missing: AnthropicNativeClient = {
      messages: {
        create: async () => {
          calls += 1;
          throw APIError.generate(404, { error: { message: "missing" } }, "missing", new Headers());
        },
      },
    };
    const missingOutcome = await createAnthropicModelClient({
      apiKey: "key",
      client: missing,
    }).invoke(request(), new AbortController().signal);
    expect(calls).toBe(1);
    expect(missingOutcome.status).toBe("failure");
    if (missingOutcome.status !== "failure") throw new Error("Expected failure");
    expect(missingOutcome.error.kind).toBe("model_not_found");

    for (const stopReason of ["max_tokens", "refusal"]) {
      const truncated = { ...response(), stop_reason: stopReason };
      const native: AnthropicNativeClient = { messages: { create: async () => truncated } };
      const outcome = await createAnthropicModelClient({ apiKey: "key", client: native }).invoke(
        request(),
        new AbortController().signal,
      );
      expect(outcome.status).toBe("failure");
      expect(outcome.rawResponse).toBe('{"answer":"yes"}');
    }
  });

  test("missing Anthropic input categories preserve reported output", async () => {
    const complete = response();
    const incomplete = {
      ...complete,
      usage: { ...complete.usage, cache_read_input_tokens: null },
    };
    const native: AnthropicNativeClient = { messages: { create: async () => incomplete } };
    const outcome = await createAnthropicModelClient({ apiKey: "key", client: native }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") throw new Error("Expected success");
    expect(outcome.usage.tokens).toEqual({ output: 4 });
  });
});

describe("Anthropic reported token directions", () => {
  /** Native usage fixtures keep expected mappings within the portable count contract. */
  const cases: readonly {
    readonly usage: Partial<AnthropicResponse["usage"]> | undefined;
    readonly expected: ModelTokens | null;
  }[] = [
    {
      usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      expected: { input: 0 },
    },
    { usage: { output_tokens: 0 }, expected: { output: 0 } },
    { usage: undefined, expected: null },
    {
      usage: {
        input_tokens: Number.MAX_SAFE_INTEGER,
        cache_read_input_tokens: 1,
        cache_creation_input_tokens: 0,
        output_tokens: 4,
      },
      expected: { output: 4 },
    },
  ];
  test.each([...cases])(
    "preserves only complete counts and sums: %j",
    async ({ usage, expected }) => {
      const native: AnthropicNativeClient = {
        messages: { create: async () => ({ ...response(), usage }) },
      };
      const outcome = await createAnthropicModelClient({ apiKey: "key", client: native }).invoke(
        request(),
        new AbortController().signal,
      );
      expect(outcome.status).toBe("success");
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.usage?.tokens).toEqual(expected);
    },
  );
});

describe("Anthropic provider adapter selection and SDK policy", () => {
  test("rejects credentials and model selection before touching the SDK", async () => {
    let calls = 0;
    const native: AnthropicNativeClient = {
      messages: {
        create: async () => {
          calls += 1;
          return response();
        },
      },
    };
    const missing = await createAnthropicModelClient({ apiKey: " ", client: native }).invoke(
      request(),
      new AbortController().signal,
    );
    const selectionSecret = "anthropic-selection-secret";
    const invalid = await createAnthropicModelClient({
      apiKey: selectionSecret,
      client: native,
    }).invoke(request("openai/model"), new AbortController().signal);

    expect(calls).toBe(0);
    if (missing.status !== "failure" || invalid.status !== "failure") {
      throw new Error("Expected failures");
    }
    expect(missing.error.kind).toBe("missing_credentials");
    expect(invalid.error.kind).toBe("invalid_model_name");
    expect(JSON.stringify(invalid)).not.toContain(selectionSecret);
  });

  test("disables hidden SDK retries under repeated HTTP failures", async () => {
    let fetchCalls = 0;
    const hermeticFetch = fetchWith(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ type: "error", error: { message: "down" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    const outcome = await createAnthropicModelClient({
      apiKey: "key",
      fetch: hermeticFetch,
    }).invoke(request(), new AbortController().signal);

    expect(outcome.status).toBe("failure");
    expect(fetchCalls).toBe(2);
    expect(outcome.attempts).toHaveLength(2);
  });
});
