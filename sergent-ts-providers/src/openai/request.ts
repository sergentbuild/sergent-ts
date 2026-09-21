import type { ModelRequest, PngImage, UserMessage } from "sergent-ts-core";
import type { ResponseInputContent, ResponseInputItem } from "openai/resources/responses/responses";
import { sdkSchemaRecord } from "../transport/index.js";
import type { OpenAIRequest } from "./native.js";

/** Converts one constructed PNG to OpenAI's data-URL image content. */
function imageContent(image: PngImage): ResponseInputContent {
  return {
    type: "input_image",
    detail: "auto",
    image_url: `data:${image.media_type};base64,${image.data}`,
  };
}

/** Maps one portable user message with text before its ordered images. */
function userInput(message: UserMessage): ResponseInputItem {
  const content: ResponseInputContent[] = [{ type: "input_text", text: message.content }];
  for (const image of message.images ?? []) content.push(imageContent(image));
  return { role: "user", content };
}

/** Builds the exact OpenAI Responses API request without replacing the schema. */
export function openAIRequest(request: ModelRequest, model: string): OpenAIRequest {
  const first = request.messages[0];
  const instructions = first?.role === "system" ? first.content : undefined;
  const schema = sdkSchemaRecord(request.proposalSchema.json_schema);
  const users = request.messages.filter(
    (message): message is UserMessage => message.role === "user",
  );
  return {
    model,
    input: users.map(userInput),
    instructions,
    max_output_tokens: request.modelSettings.maxOutputTokens,
    reasoning: { effort: request.modelSettings.thinkingEffort },
    text: {
      format: {
        type: "json_schema",
        name: request.proposalSchema.name,
        schema,
        strict: true,
      },
    },
  };
}
