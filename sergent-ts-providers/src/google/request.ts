import type { Content, GenerateContentConfig, Part } from "@google/genai";
import type { ModelRequest, PngImage, UserMessage } from "sergent-ts-core";
import type { GoogleRequest } from "./native.js";

/** Converts one constructed PNG to Gemini inline image data. */
function imagePart(image: PngImage): Part {
  return { inlineData: { mimeType: image.media_type, data: image.data } };
}

/** Maps one portable user message with text before its ordered images. */
function userContent(message: UserMessage): Content {
  const parts: Part[] = [{ text: message.content }];
  for (const image of message.images ?? []) parts.push(imagePart(image));
  return { role: "user", parts };
}

/** Builds Google request data while delegating thinking to Gemini's dynamic default. */
export function googleRequest(request: ModelRequest, model: string): GoogleRequest {
  const first = request.messages[0];
  const systemInstruction =
    first?.role === "system" ? { parts: [{ text: first.content }] } : undefined;
  const users = request.messages.filter(
    (message): message is UserMessage => message.role === "user",
  );
  const config: GenerateContentConfig = {
    systemInstruction,
    maxOutputTokens: request.modelSettings.maxOutputTokens,
    responseMimeType: "application/json",
    responseJsonSchema: request.proposalSchema.json_schema,
    httpOptions: {
      timeout: request.modelSettings.timeoutMs,
      retryOptions: { attempts: 1 },
    },
  };
  return { model, contents: users.map(userContent), config };
}

/** Binds one attempt signal without changing the native request's semantic data. */
export function googleAttemptRequest(body: GoogleRequest, signal: AbortSignal): GoogleRequest {
  return { ...body, config: { ...body.config, abortSignal: signal } };
}
