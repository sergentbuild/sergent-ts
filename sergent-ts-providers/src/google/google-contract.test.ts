import { describe, expect, test } from "bun:test";
import { ApiError, FinishReason } from "@google/genai";
import {
  Type,
  createMessages,
  createModelRequest,
  createModelSettings,
  createProposalDefinition,
  createUserMessage,
} from "sergent-ts-core";
import type { TransportFailureKind } from "sergent-ts-core";
import { createGoogleModelClient } from "./index.js";
import type { GoogleNativeClient, GoogleResponse } from "./native.js";

const SECRET = "google-secret-never-recorded";

/** One typed SDK failure classification expectation. */
interface ClassificationCase {
  readonly label: string;
  readonly kind: TransportFailureKind;
  readonly attempts: 1 | 2;
  error(): unknown;
}

const CLASSIFICATION_CASES: readonly ClassificationCase[] = [
  {
    label: "connection or body read failure",
    kind: "provider_unavailable",
    attempts: 2,
    error: () => new TypeError("fetch failed"),
  },
  {
    label: "response body that is not JSON",
    kind: "invalid_response",
    attempts: 1,
    error: () => new SyntaxError("Unexpected token in JSON"),
  },
  {
    label: "rate limit",
    kind: "rate_limited",
    attempts: 2,
    error: () => new ApiError({ status: 429, message: "limited" }),
  },
  {
    label: "server outage",
    kind: "provider_unavailable",
    attempts: 2,
    error: () => new ApiError({ status: 503, message: "down" }),
  },
  {
    label: "missing model",
    kind: "model_not_found",
    attempts: 1,
    error: () => new ApiError({ status: 404, message: "missing" }),
  },
  {
    label: "other provider error",
    kind: "provider_error",
    attempts: 1,
    error: () => new ApiError({ status: 400, message: "bad" }),
  },
];

/** Constructs a minimal complete portable Google request. */
function request() {
  const proposal = createProposalDefinition(
    "AnswerProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  return createModelRequest(
    "google/model",
    createMessages([createUserMessage("question")]),
    proposal.proposal_schema,
    createModelSettings(64, 500, "low"),
  );
}

/** Creates one naturally completed SDK-shaped Gemini response. */
function response(): GoogleResponse {
  return {
    candidates: [
      {
        finishReason: FinishReason.STOP,
        content: { parts: [{ text: '{"answer":"yes"}' }] },
      },
    ],
    responseId: "google-request",
    usageMetadata: { promptTokenCount: 2, totalTokenCount: 3 },
  };
}

describe("Google owned error classification", () => {
  for (const item of CLASSIFICATION_CASES) {
    test(item.label, async () => {
      let calls = 0;
      const native: GoogleNativeClient = {
        models: {
          generateContent: async () => {
            calls += 1;
            throw item.error();
          },
        },
      };
      const outcome = await createGoogleModelClient({ apiKey: SECRET, client: native }).invoke(
        request(),
        new AbortController().signal,
      );

      expect(calls).toBe(item.attempts);
      expect(outcome.status).toBe("failure");
      if (outcome.status !== "failure") throw new Error("Expected failure");
      expect(outcome.error.kind).toBe(item.kind);
      expect(outcome.attempts).toHaveLength(item.attempts);
      expect(outcome.attempts.every((attempt) => attempt.error?.kind === item.kind)).toBe(true);
      expect(outcome.rawResponse).toBeNull();
      expect(outcome.usage).toBeNull();
      expect(JSON.stringify(outcome)).not.toContain(SECRET);
    });
  }
});

describe("Google malformed response and cancellation", () => {
  test("rejects malformed HTTP-200 envelope once without invented evidence", async () => {
    let calls = 0;
    const native: GoogleNativeClient = {
      models: {
        generateContent: async () => {
          calls += 1;
          return {
            ...response(),
            candidates: [
              {
                finishReason: FinishReason.STOP,
                content: { parts: [null] },
              },
            ],
          };
        },
      },
    };
    const outcome = await createGoogleModelClient({ apiKey: SECRET, client: native }).invoke(
      request(),
      new AbortController().signal,
    );

    expect(calls).toBe(1);
    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("invalid_response");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.rawResponse).toBeNull();
    expect(outcome.usage).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });

  test("cancels retry after retaining one completed connection failure", async () => {
    const caller = new AbortController();
    let calls = 0;
    const native: GoogleNativeClient = {
      models: {
        generateContent: async () => {
          calls += 1;
          if (calls === 1) throw new TypeError("fetch failed");
          caller.abort();
          return response();
        },
      },
    };
    const outcome = await createGoogleModelClient({ apiKey: SECRET, client: native }).invoke(
      request(),
      caller.signal,
    );

    expect(calls).toBe(2);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.error?.kind).toBe("provider_unavailable");
    expect(outcome.rawResponse).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(SECRET);
  });
});
