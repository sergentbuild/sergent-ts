import { expect, test } from "bun:test";
import type { ChatCompletion } from "@mlc-ai/web-llm/lib/openai_api_protocols/chat_completion.js";
import {
  createMessages,
  createModelRequest,
  createModelSettings,
  createPngImage,
  createProposalDefinition,
  createSystemMessage,
  createUserMessage,
  Type,
} from "sergent-ts-core";
import { admitResponse } from "./native/index.js";
import { PROFILE, ready, request, response, tokenUsage } from "./session-fixture.test.js";

test("native request preserves ordered text and the exact canonical schema string", async () => {
  const value = await ready();
  const schema = Type.Unsafe({
    type: "object",
    additionalProperties: false,
    properties: {
      values: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        items: { anyOf: [{ $ref: "#/$defs/Text" }, { type: "string", enum: ["yes", "no"] }] },
      },
    },
    required: ["values"],
    $defs: { Text: { type: "string", description: "Exact text" } },
  });
  const proposal = createProposalDefinition("nested", schema);
  const messages = createMessages(
    [createUserMessage("first"), createUserMessage("second")],
    createSystemMessage("system"),
  );
  const built = createModelRequest(
    `webllm/${PROFILE.modelId}`,
    messages,
    proposal.proposal_schema,
    createModelSettings(128, 100, "low"),
  );
  const result = await value.session.client.invoke(built, new AbortController().signal);
  expect(result.status).toBe("success");
  expect(value.engine.requests).toHaveLength(1);
  expect(value.engine.requests[0]).toEqual({
    model: PROFILE.modelId,
    messages: [
      { role: "system", content: "system" },
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ],
    response_format: { type: "json_object", schema: JSON.stringify(schema) },
    n: 1,
    stream: false,
    temperature: 0.1,
    max_tokens: 128,
  });
  value.session.close();
});

test.each([Type.Number(), Type.Boolean(), Type.Null(), Type.Array(Type.String())])(
  "unqualified canonical schema fails before reset or native dispatch",
  async (field) => {
    const value = await ready();
    const original = request();
    const schema = createProposalDefinition(
      "unsupported",
      Type.Object({ field }, { additionalProperties: false }),
    );
    const result = await value.session.client.invoke(
      createModelRequest(
        original.modelName,
        original.messages,
        schema.proposal_schema,
        original.modelSettings,
      ),
      new AbortController().signal,
    );
    expect(result.status).toBe("failure");
    if (result.status !== "failure") throw new Error("Expected capability rejection");
    expect(result.error.kind).toBe("invalid_payload");
    expect(result.identity?.model).toBe(PROFILE.modelId);
    expect(result.attempts).toHaveLength(0);
    expect(value.engine.resets).toHaveLength(0);
    expect(value.session.state.kind).toBe("ready");
    value.session.close();
  },
);

test("model, images, effort, and output capability mismatches create no attempt", async () => {
  const value = await ready();
  const original = request();
  const variants = [
    createModelRequest(
      "webllm/other",
      original.messages,
      original.proposalSchema,
      original.modelSettings,
    ),
    createModelRequest(
      original.modelName,
      createMessages([createUserMessage("image", [createPngImage(new Uint8Array([1]))])]),
      original.proposalSchema,
      original.modelSettings,
    ),
    createModelRequest(
      original.modelName,
      original.messages,
      original.proposalSchema,
      createModelSettings(128, 100, "high"),
    ),
    createModelRequest(
      original.modelName,
      original.messages,
      original.proposalSchema,
      createModelSettings(PROFILE.contextWindowSize, 100, "low"),
    ),
  ];
  for (const [index, variant] of variants.entries()) {
    const result = await value.session.client.invoke(variant, new AbortController().signal);
    expect(result.status).toBe("failure");
    if (result.status !== "failure") throw new Error("Expected capability rejection");
    expect(result.error.kind).toBe(index === 0 ? "invalid_model_name" : "invalid_payload");
    expect(result.attempts).toHaveLength(0);
  }
  expect(value.engine.resets).toHaveLength(0);
  value.session.close();
});

test.each(["length", "abort", "tool_calls"] as const)(
  "native %s completion retains reached text without parsing and remains healthy",
  async (finish) => {
    const value = await ready();
    const raw = '{"text":"partial"}';
    value.engine.completionResult = Promise.resolve(response(raw, finish));
    const result = await value.session.client.invoke(request(), new AbortController().signal);
    expect(result.status).toBe("failure");
    if (result.status !== "failure") throw new Error("Expected native finish rejection");
    expect(result.error.kind).toBe("invalid_response");
    expect(result.rawResponse).toBe(raw);
    expect(result.parsedJson).toBeNull();
    expect(result.usage?.tokens).toEqual({ input: 20, output: 8, total: 28 });
    expect(result.attempts).toHaveLength(1);
    expect(value.session.state.kind).toBe("ready");
    expect(value.worker.terminations).toBe(0);
    value.session.close();
  },
);

test.each([
  "<think>\n\n</think>\n\n{}",
  "```json\n{}\n```",
  "Here: {}",
  "{} trailing",
  "[{}]",
  "null",
  "3",
  "",
  "{bad",
])("exact response parse rejects %s without repair", (raw) => {
  const evidence = admitResponse(response(raw), PROFILE.modelId);
  expect(evidence.rawResponse).toBe(raw);
  expect(evidence.parsedJson).toBeNull();
});

test("natural single assistant output preserves exact text and rejects competing channels", () => {
  const raw = ` \n${JSON.stringify({ text: 'quoted "word"' })}\n`;
  const good = admitResponse(response(raw), PROFILE.modelId);
  expect(good.parsedJson).toEqual({ text: 'quoted "word"' });
  expect(good.rawResponse).toBe(raw);
  const choice: ChatCompletion.Choice = {
    finish_reason: "stop",
    index: 0,
    logprobs: null,
    message: { role: "assistant", content: raw },
  };
  const bad: ChatCompletion[] = [
    { ...response(raw), model: "other" },
    { ...response(raw), choices: [choice, choice] },
    {
      ...response(raw),
      choices: [{ ...choice, message: { ...choice.message, tool_calls: [] } }],
    },
  ];
  for (const candidate of bad)
    expect(admitResponse(candidate, PROFILE.modelId).parsedJson).toBeNull();
});

test.each([
  undefined,
  tokenUsage(-1, 8),
  tokenUsage(1.5, 1),
  tokenUsage(20, 8, 29),
  tokenUsage(Number.MAX_SAFE_INTEGER, 1),
])("missing or inconsistent native token facts stay unknown", (usage) => {
  const evidence = admitResponse(
    {
      ...response("{}"),
      usage,
    },
    PROFILE.modelId,
  );
  expect(evidence.parsedJson).not.toBeNull();
  expect(evidence.tokens).toBeNull();
});
