import { describe, expect, test } from "bun:test";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "@anthropic-ai/sdk";
import {
  Type,
  createMessages,
  createModelRequest,
  createModelSettings,
  createProposalDefinition,
  createUserMessage,
} from "sergent-ts-core";
import type { TransportFailureKind } from "sergent-ts-core";
import { createAnthropicModelClient } from "./index.js";
import type { AnthropicNativeClient, AnthropicResponse } from "./native.js";

const SECRET = "anthropic-secret-never-recorded";

/** One typed SDK failure classification expectation. */
interface ClassificationCase {
  readonly label: string;
  readonly kind: TransportFailureKind;
  readonly attempts: 1 | 2;
  error(): unknown;
}

const CLASSIFICATION_CASES: readonly ClassificationCase[] = [
  {
    label: "timeout",
    kind: "timeout",
    attempts: 2,
    error: () => new APIConnectionTimeoutError(),
  },
  {
    label: "connection",
    kind: "provider_unavailable",
    attempts: 2,
    error: () => new APIConnectionError({ message: "connection" }),
  },
  {
    label: "rate limit",
    kind: "rate_limited",
    attempts: 2,
    error: () => APIError.generate(429, {}, "limited", new Headers()),
  },
  {
    label: "server outage",
    kind: "provider_unavailable",
    attempts: 2,
    error: () => APIError.generate(503, {}, "down", new Headers()),
  },
  {
    label: "missing model",
    kind: "model_not_found",
    attempts: 1,
    error: () => APIError.generate(404, {}, "missing", new Headers()),
  },
  {
    label: "other provider error",
    kind: "provider_error",
    attempts: 1,
    error: () => APIError.generate(400, {}, "bad", new Headers()),
  },
];

/** Constructs a minimal complete portable Anthropic request. */
function request() {
  const proposal = createProposalDefinition(
    "AnswerProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  return createModelRequest(
    "anthropic/model",
    createMessages([createUserMessage("question")]),
    proposal.proposal_schema,
    createModelSettings(64, 500, "low"),
  );
}

/** Creates one naturally completed SDK-shaped Anthropic response. */
function response(): AnthropicResponse {
  return {
    content: [{ type: "text", text: '{"answer":"yes"}' }],
    stop_reason: "end_turn",
    stop_details: null,
    usage: {
      input_tokens: 2,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 1,
    },
    _request_id: "anthropic-request",
  };
}

describe("Anthropic owned error classification", () => {
  for (const item of CLASSIFICATION_CASES) {
    test(item.label, async () => {
      let calls = 0;
      const native: AnthropicNativeClient = {
        messages: {
          create: async () => {
            calls += 1;
            throw item.error();
          },
        },
      };
      const outcome = await createAnthropicModelClient({ apiKey: SECRET, client: native }).invoke(
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

describe("Anthropic malformed response and cancellation", () => {
  test("rejects malformed HTTP-200 envelope once without invented evidence", async () => {
    let calls = 0;
    const native: AnthropicNativeClient = {
      messages: {
        create: async () => {
          calls += 1;
          return { ...response(), content: null };
        },
      },
    };
    const outcome = await createAnthropicModelClient({ apiKey: SECRET, client: native }).invoke(
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
    const native: AnthropicNativeClient = {
      messages: {
        create: async () => {
          calls += 1;
          if (calls === 1) throw new APIConnectionError({ message: "connection" });
          caller.abort();
          return response();
        },
      },
    };
    const outcome = await createAnthropicModelClient({ apiKey: SECRET, client: native }).invoke(
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
