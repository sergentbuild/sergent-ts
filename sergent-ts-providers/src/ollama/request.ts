import type { ModelRequest, UserMessage } from "sergent-ts-core";
import type { Message } from "ollama";
import type { OllamaRequest } from "./native.js";

/** Maps one portable user message with text and ordered base64 PNG images. */
function userMessage(message: UserMessage): Message {
  return {
    role: "user",
    content: message.content,
    images: message.images?.map((image) => image.data),
  };
}

/** Builds one exact Ollama request, preserving the canonical schema object. */
export function ollamaRequest(request: ModelRequest, model: string): OllamaRequest {
  const first = request.messages[0];
  const messages: Message[] = [];
  if (first?.role === "system") messages.push({ role: "system", content: first.content });
  const users = request.messages.filter(
    (message): message is UserMessage => message.role === "user",
  );
  messages.push(...users.map(userMessage));
  return {
    model,
    messages,
    format: request.proposalSchema.json_schema,
    stream: false,
    think: request.modelSettings.thinkingEffort !== "low",
    options: { num_predict: request.modelSettings.maxOutputTokens },
  };
}
