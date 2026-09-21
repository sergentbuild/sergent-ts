import { createTransportError } from "sergent-ts-core";
import type { ModelRequest, TransportError } from "sergent-ts-core";
import type { NativeRequest, WebLlmProfile } from "./contract.js";

/** One compatible native request or an existing zero-attempt transport failure. */
export type RequestAdmission =
  | Readonly<{ ok: true; request: NativeRequest }>
  | Readonly<{ ok: false; error: TransportError }>;

/** Tests only the narrower native subset of an already canonical schema. */
function supportedNode(node: unknown): boolean {
  if (!schemaObject(node)) return false;
  if (node.$ref !== undefined) return true;
  if (Array.isArray(node.anyOf)) return node.anyOf.every(supportedNode);
  if (node.enum !== undefined)
    return Array.isArray(node.enum) && node.enum.every((value) => typeof value === "string");
  switch (node.type) {
    case "object":
      return supportedMap(node.properties);
    case "array":
      return supportedArray(node);
    case "string":
      return true;
    default:
      return false;
  }
}

/** Arrays need qualified item-count bounds and a supported element schema. */
function supportedArray(node: Record<string, unknown>): boolean {
  return node.minItems !== undefined && node.maxItems !== undefined && supportedNode(node.items);
}

/** Narrows the canonical schema's generic carrier for native compatibility inspection. */
function schemaObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Visits only canonical schema-bearing maps, including otherwise unused definitions. */
function supportedMap(value: unknown): boolean {
  return schemaObject(value) && Object.values(value).every(supportedNode);
}

/** Inspects the root and all local definitions without re-rendering or changing identity. */
function supportedSchema(value: unknown): boolean {
  if (!schemaObject(value)) return false;
  return supportedNode(value) && (value.$defs === undefined || supportedMap(value.$defs));
}

/** Admits the provider's capabilities and encodes the exact canonical schema once. */
export function admitRequest(request: ModelRequest, profile: WebLlmProfile): RequestAdmission {
  if (request.modelName !== `webllm/${profile.modelId}`) {
    return {
      ok: false,
      error: createTransportError(
        "invalid_model_name",
        "The requested model does not match this session",
      ),
    };
  }
  const settings = request.modelSettings;
  const textOnly = request.messages.every(
    (message) => message.role === "system" || !message.images?.length,
  );
  if (
    !textOnly ||
    settings.thinkingEffort !== "low" ||
    settings.maxOutputTokens >= profile.contextWindowSize ||
    !supportedSchema(request.proposalSchema.json_schema)
  ) {
    return {
      ok: false,
      error: createTransportError(
        "invalid_payload",
        "The request exceeds this WebLLM profile's supported capabilities",
      ),
    };
  }
  return {
    ok: true,
    request: {
      model: profile.modelId,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      response_format: {
        type: "json_object",
        schema: JSON.stringify(request.proposalSchema.json_schema),
      },
      stream: false,
      n: 1,
      temperature: profile.temperature,
      max_tokens: settings.maxOutputTokens,
    },
  };
}
