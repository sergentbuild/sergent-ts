import { describe, expect, test } from "bun:test";
import type { ModelTokens } from "sergent-ts-core";
import { createOpenAIModelClient } from "./index.js";
import type { OpenAINativeClient, OpenAIResponse } from "./native.js";
import { request, response } from "./openai-fixtures.test.js";

describe("OpenAI reported token directions", () => {
  /** Native usage fixtures retain partial directions without widening expected token values. */
  const cases: readonly {
    readonly usage: Partial<NonNullable<OpenAIResponse["usage"]>> | undefined;
    readonly expected: ModelTokens | null;
  }[] = [
    { usage: { input_tokens: 0 }, expected: { input: 0 } },
    { usage: { output_tokens: 0 }, expected: { output: 0 } },
    { usage: undefined, expected: null },
  ];
  test.each([...cases])("preserves exactly known counts: %j", async ({ usage, expected }) => {
    const native: OpenAINativeClient = {
      responses: { create: async () => ({ ...response(), usage }) },
    };
    const outcome = await createOpenAIModelClient({ apiKey: "key", client: native }).invoke(
      request(),
      new AbortController().signal,
    );
    expect(outcome.status).toBe("success");
    expect(outcome.attempts).toHaveLength(1);
    expect(outcome.usage?.tokens).toEqual(expected);
  });
});
