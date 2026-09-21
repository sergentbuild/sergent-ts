import { describe, expect, test } from "bun:test";
import {
  Type,
  createMessages,
  createModelRequest,
  createModelSettings,
  createProposalDefinition,
  createUserMessage,
} from "sergent-ts-core";
import type { TransportFailureKind } from "sergent-ts-core";
import { createOllamaModelClient } from "./index.js";

const SECRET_HOST = "http://ollama-secret-never-recorded.test:11434";

/** One SDK fetch failure classification expectation. */
interface ClassificationCase {
  readonly label: string;
  readonly kind: TransportFailureKind;
  readonly attempts: 1 | 2;
  respond(): Promise<Response>;
}

/** Returns an application/json response for the SDK-shaped fetch seam. */
function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const CLASSIFICATION_CASES: readonly ClassificationCase[] = [
  {
    label: "timeout",
    kind: "timeout",
    attempts: 2,
    respond: async () => {
      throw new DOMException("timeout", "TimeoutError");
    },
  },
  {
    label: "connection",
    kind: "provider_unavailable",
    attempts: 2,
    respond: async () => {
      throw new TypeError("connection");
    },
  },
  {
    label: "rate limit",
    kind: "rate_limited",
    attempts: 2,
    respond: async () => jsonResponse({ error: "limited" }, 429),
  },
  {
    label: "server outage",
    kind: "provider_unavailable",
    attempts: 2,
    respond: async () => jsonResponse({ error: "down" }, 503),
  },
  {
    label: "missing model",
    kind: "model_not_found",
    attempts: 1,
    respond: async () => jsonResponse({ error: "missing" }, 404),
  },
  {
    label: "other provider error",
    kind: "provider_error",
    attempts: 1,
    respond: async () => jsonResponse({ error: "bad" }, 400),
  },
];

/** Creates a hermetic fetch function with Bun's preconnect surface. */
function fetchWith(
  handler: (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: () => undefined });
}

/** Constructs a minimal complete portable Ollama request. */
function request() {
  const proposal = createProposalDefinition(
    "AnswerProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  return createModelRequest(
    "ollama/model",
    createMessages([createUserMessage("question")]),
    proposal.proposal_schema,
    createModelSettings(64, 500, "low"),
  );
}

/** Creates one naturally completed SDK-shaped Ollama response body. */
function response() {
  return {
    message: { role: "assistant", content: '{"answer":"yes"}' },
    done: true,
    done_reason: "stop",
    prompt_eval_count: 2,
    eval_count: 1,
  };
}

describe("Ollama owned error classification", () => {
  for (const item of CLASSIFICATION_CASES) {
    test(item.label, async () => {
      let calls = 0;
      const hermeticFetch = fetchWith(async () => {
        calls += 1;
        return item.respond();
      });
      const outcome = await createOllamaModelClient({
        host: SECRET_HOST,
        fetch: hermeticFetch,
      }).invoke(request(), new AbortController().signal);

      expect(calls).toBe(item.attempts);
      expect(outcome.status).toBe("failure");
      if (outcome.status !== "failure") throw new Error("Expected failure");
      expect(outcome.error.kind).toBe(item.kind);
      expect(outcome.attempts).toHaveLength(item.attempts);
      expect(outcome.attempts.every((attempt) => attempt.error?.kind === item.kind)).toBe(true);
      expect(outcome.rawResponse).toBeNull();
      expect(outcome.usage).toBeNull();
      expect(JSON.stringify(outcome)).not.toContain(SECRET_HOST);
    });
  }
});

describe("Ollama malformed response and cancellation", () => {
  test("rejects malformed HTTP-200 envelope once without invented evidence", async () => {
    let calls = 0;
    const hermeticFetch = fetchWith(async () => {
      calls += 1;
      return jsonResponse({ ...response(), message: null });
    });
    const outcome = await createOllamaModelClient({
      host: SECRET_HOST,
      fetch: hermeticFetch,
    }).invoke(request(), new AbortController().signal);

    expect(calls).toBe(1);
    expect(outcome.status).toBe("failure");
    if (outcome.status !== "failure") throw new Error("Expected failure");
    expect(outcome.error.kind).toBe("invalid_response");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.rawResponse).toBeNull();
    expect(outcome.usage).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(SECRET_HOST);
  });

  test("cancels retry after retaining one completed server failure", async () => {
    const caller = new AbortController();
    let calls = 0;
    const hermeticFetch = fetchWith(async () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ error: "down" }, 503);
      caller.abort();
      return jsonResponse(response());
    });
    const outcome = await createOllamaModelClient({
      host: SECRET_HOST,
      fetch: hermeticFetch,
    }).invoke(request(), caller.signal);

    expect(calls).toBe(2);
    expect(outcome.status).toBe("cancelled");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.attempts[0]?.error?.kind).toBe("provider_unavailable");
    expect(outcome.rawResponse).toBeNull();
    expect(JSON.stringify(outcome)).not.toContain(SECRET_HOST);
  });
});
