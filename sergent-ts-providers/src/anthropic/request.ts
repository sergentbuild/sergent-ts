import type { ModelRequest, PngImage, UserMessage } from "sergent-ts-core";
import type {
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages/messages";
import { sdkSchemaRecord } from "../transport/index.js";
import type { AnthropicRequest } from "./native.js";

/** Converts one constructed PNG to Anthropic's base64 image content. */
function imageContent(image: PngImage): ContentBlockParam {
  return {
    type: "image",
    source: { type: "base64", media_type: image.media_type, data: image.data },
  };
}

/** Maps one portable user message with text before its ordered images. */
function userInput(message: UserMessage): MessageParam {
  const content: ContentBlockParam[] = [{ type: "text", text: message.content }];
  for (const image of message.images ?? []) content.push(imageContent(image));
  return { role: "user", content };
}

/** Builds the exact Anthropic Messages request without replacing the schema. */
export function anthropicRequest(request: ModelRequest, model: string): AnthropicRequest {
  const first = request.messages[0];
  const system = first?.role === "system" ? first.content : undefined;
  const users = request.messages.filter(
    (message): message is UserMessage => message.role === "user",
  );
  const schema = sdkSchemaRecord(request.proposalSchema.json_schema);
  return {
    model,
    max_tokens: request.modelSettings.maxOutputTokens,
    messages: users.map(userInput),
    system,
    thinking: { type: "adaptive" },
    output_config: {
      effort: request.modelSettings.thinkingEffort,
      format: { type: "json_schema", schema },
    },
  };
}
