/** Shared native request and response fixtures for OpenAI adapter contracts. */
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
import type { ModelRequest } from "sergent-ts-core";
import type { OpenAIResponse } from "./native.js";

/** Constructs one complete portable request for OpenAI translation and evidence tests. */
export function request(
  modelName = "openai/org/model",
  effort: "low" | "medium" | "high" = "high",
): ModelRequest {
  const proposal = createProposalDefinition(
    "AnswerProposal",
    Type.Object({ answer: Type.String() }, { additionalProperties: false }),
  );
  const messages = createMessages(
    [
      createUserMessage("first", [
        createPngImage(new Uint8Array([1])),
        createPngImage(new Uint8Array([2])),
      ]),
      createUserMessage("second", [
        createPngImage(new Uint8Array([3])),
        createPngImage(new Uint8Array([4])),
      ]),
    ],
    createSystemMessage("system"),
  );
  return createModelRequest(
    modelName,
    messages,
    proposal.proposal_schema,
    createModelSettings(128, 250, effort),
  );
}

/** Creates a completed SDK-shaped OpenAI response. */
export function response(rawResponse = '{"answer":"yes"}'): OpenAIResponse {
  return {
    status: "completed",
    error: null,
    incomplete_details: null,
    output: [],
    output_text: rawResponse,
    usage: { input_tokens: 7, output_tokens: 4 },
    _request_id: "openai-request",
  };
}
