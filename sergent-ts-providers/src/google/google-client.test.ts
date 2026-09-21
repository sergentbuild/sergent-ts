import { describe, expect, test } from "bun:test";
import { FinishReason } from "@google/genai";
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
import { createGoogleModelClient } from "./index.js";
import type { GoogleNativeClient, GoogleRequest, GoogleResponse } from "./native.js";
import providerManifest from "../../package.json" with { type: "json" };

/** Constructs one complete portable request for Google translation tests. */
function request(modelName = "google/team/model", effort: "low" | "medium" | "high" = "high") {
  const proposal = createProposalDefinition(
    "AnswerProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  const messages = createMessages(
    [
      createUserMessage("first", [
        createPngImage(new Uint8Array([8])),
        createPngImage(new Uint8Array([9])),
      ]),
      createUserMessage("second", [
        createPngImage(new Uint8Array([10])),
        createPngImage(new Uint8Array([11])),
      ]),
    ],
    createSystemMessage("system"),
  );
  return createModelRequest(
    modelName,
    messages,
    proposal.proposal_schema,
    createModelSettings(160, 350, effort),
  );
}

/** Creates a naturally completed SDK-shaped Gemini response. */
function response(rawParts = ['{"answer":', '"yes"}']): GoogleResponse {
  return {
    candidates: [
      {
        finishReason: FinishReason.STOP,
        content: {
          role: "model",
          parts: rawParts.map((text) => ({ text })),
        },
      },
    ],
    responseId: "google-request",
    usageMetadata: { promptTokenCount: 5, totalTokenCount: 9 },
  };
}

describe("Google provider adapter", () => {
  test("maps schema and settings without overriding dynamic thinking", async () => {
    let body: GoogleRequest | undefined;
    const native: GoogleNativeClient = {
      models: {
        generateContent: async (nextBody) => {
          body = nextBody;
          return response();
        },
      },
    };
    const portable = request();
    const secret = "google-success-secret";
    const outcome = await createGoogleModelClient({ apiKey: secret, client: native }).invoke(
      portable,
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success" || body === undefined) {
      throw new Error("Expected one captured Google success");
    }
    expect(body.model).toBe("team/model");
    expect(body.contents).toEqual([
      {
        role: "user",
        parts: [
          { text: "first" },
          { inlineData: { mimeType: "image/png", data: "CA==" } },
          { inlineData: { mimeType: "image/png", data: "CQ==" } },
        ],
      },
      {
        role: "user",
        parts: [
          { text: "second" },
          { inlineData: { mimeType: "image/png", data: "Cg==" } },
          { inlineData: { mimeType: "image/png", data: "Cw==" } },
        ],
      },
    ]);
    expect(body.config?.systemInstruction).toEqual({ parts: [{ text: "system" }] });
    expect(body.config?.maxOutputTokens).toBe(160);
    expect(body.config?.responseMimeType).toBe("application/json");
    expect(body.config?.responseJsonSchema).toBe(portable.proposalSchema.json_schema);
    expect(body.config?.httpOptions).toMatchObject({
      timeout: 350,
      retryOptions: { attempts: 1 },
    });
    expect(Object.hasOwn(body.config ?? {}, "thinkingConfig")).toBe(false);
    expect(body.config?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(outcome.identity).toEqual({
      provider: "google",
      model: "team/model",
      sdkPackage: "@google/genai",
      sdkVersion: providerManifest.dependencies["@google/genai"],
    });
    expect(outcome.rawResponse).toBe('{"answer":"yes"}');
    expect(outcome.usage.tokens).toEqual({ input: 5, output: 4 });
    expect(outcome.usage.requestId).toBe("google-request");
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });
});

describe("Google thinking effort translation", () => {
  for (const effort of ["low", "medium", "high"] as const) {
    test(`omits thinkingConfig for ${effort}`, async () => {
      let body: GoogleRequest | undefined;
      const native: GoogleNativeClient = {
        models: {
          generateContent: async (nextBody) => {
            body = nextBody;
            return response();
          },
        },
      };
      const outcome = await createGoogleModelClient({ apiKey: "key", client: native }).invoke(
        request("google/team/model", effort),
        new AbortController().signal,
      );

      expect(outcome.status).toBe("success");
      expect(Object.hasOwn(body?.config ?? {}, "thinkingConfig")).toBe(false);
    });
  }
});

describe("Google provider adapter retry and admission", () => {
  test("preserves semantic native data while binding a fresh retry signal", async () => {
    const bodies: GoogleRequest[] = [];
    const native: GoogleNativeClient = {
      models: {
        generateContent: async (body) => {
          bodies.push(body);
          if (bodies.length === 1) throw new TypeError("fetch failed");
          return response();
        },
      },
    };
    const portable = request();
    const outcome = await createGoogleModelClient({ apiKey: "key", client: native }).invoke(
      portable,
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toBe(bodies[0]);
    expect(bodies[1]?.contents).toBe(bodies[0]?.contents);
    expect(bodies[1]?.config?.responseJsonSchema).toBe(portable.proposalSchema.json_schema);
    expect(bodies[1]?.config?.abortSignal).not.toBe(bodies[0]?.config?.abortSignal);
  });

  test("rejects blocked, ambiguous, truncated, and malformed responses", async () => {
    const blocked = {
      ...response(),
      promptFeedback: { blockReason: "SAFETY" },
    } as GoogleResponse;
    const ambiguous = {
      ...response(),
      candidates: response().candidates?.concat(response().candidates ?? []),
    };
    const truncated = {
      ...response(),
      candidates: [{ ...response().candidates?.[0], finishReason: FinishReason.MAX_TOKENS }],
    } as GoogleResponse;
    const malformed = response(["not-json"]);
    for (const nativeResponse of [blocked, ambiguous, truncated, malformed]) {
      const native: GoogleNativeClient = {
        models: { generateContent: async () => nativeResponse },
      };
      const outcome = await createGoogleModelClient({ apiKey: "key", client: native }).invoke(
        request(),
        new AbortController().signal,
      );
      expect(outcome.status).toBe("failure");
      if (outcome.status !== "failure") throw new Error("Expected failure");
      expect(outcome.error.kind).toBe("invalid_response");
      expect(outcome.attempts).toHaveLength(1);
    }
  });
});

describe("Google provider adapter evidence and selection", () => {
  test("inconsistent Google totals preserve the reported prompt count", async () => {
    const incomplete = {
      ...response(),
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 9 },
    };
    const native: GoogleNativeClient = {
      models: { generateContent: async () => incomplete },
    };
    const outcome = await createGoogleModelClient({ apiKey: "key", client: native }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(outcome.status).toBe("success");
    if (outcome.status !== "success") throw new Error("Expected success");
    expect(outcome.usage.tokens).toEqual({ input: 10 });
  });

  test("rejects credentials and model selection before touching the SDK", async () => {
    let calls = 0;
    const native: GoogleNativeClient = {
      models: {
        generateContent: async () => {
          calls += 1;
          return response();
        },
      },
    };
    const missing = await createGoogleModelClient({ apiKey: " ", client: native }).invoke(
      request(),
      new AbortController().signal,
    );
    const selectionSecret = "google-selection-secret";
    const invalid = await createGoogleModelClient({
      apiKey: selectionSecret,
      client: native,
    }).invoke(request("ollama/model"), new AbortController().signal);

    expect(calls).toBe(0);
    if (missing.status !== "failure" || invalid.status !== "failure") {
      throw new Error("Expected failures");
    }
    expect(missing.error.kind).toBe("missing_credentials");
    expect(invalid.error.kind).toBe("invalid_model_name");
    expect(JSON.stringify(invalid)).not.toContain(selectionSecret);
  });
});

describe("Google reported token directions", () => {
  /** Native usage fixtures preserve the portable mapping type beside Google's optional counters. */
  const cases: readonly {
    readonly usageMetadata: GoogleResponse["usageMetadata"];
    readonly expected: ModelTokens | null;
  }[] = [
    { usageMetadata: { promptTokenCount: 0 }, expected: { input: 0 } },
    { usageMetadata: { totalTokenCount: 4 }, expected: null },
    {
      usageMetadata: { promptTokenCount: 0, totalTokenCount: 0 },
      expected: { input: 0, output: 0 },
    },
    { usageMetadata: undefined, expected: null },
  ];
  test.each([...cases])(
    "preserves counts with complete difference operands: %j",
    async ({ usageMetadata, expected }) => {
      const native: GoogleNativeClient = {
        models: { generateContent: async () => ({ ...response(), usageMetadata }) },
      };
      const outcome = await createGoogleModelClient({ apiKey: "key", client: native }).invoke(
        request(),
        new AbortController().signal,
      );
      expect(outcome.status).toBe("success");
      expect(outcome.attempts).toHaveLength(1);
      expect(outcome.usage?.tokens).toEqual(expected);
    },
  );
});

describe("Google provider adapter SDK policy", () => {
  test("uses one SDK-shaped call per adapter attempt with retries disabled", async () => {
    let calls = 0;
    const native: GoogleNativeClient = {
      models: {
        generateContent: async (body) => {
          calls += 1;
          expect(body.config?.httpOptions?.retryOptions?.attempts).toBe(1);
          throw new TypeError("fetch failed");
        },
      },
    };
    const outcome = await createGoogleModelClient({ apiKey: "key", client: native }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(outcome.status).toBe("failure");
    expect(calls).toBe(2);
    expect(outcome.attempts).toHaveLength(2);
  });
});
