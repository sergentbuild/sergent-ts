/** Maximum decoded bytes retained by one constructed PNG image. */
const MAX_IMAGE_BYTES = 1_000_000;

/** Maximum bytes converted in one portable character-code call. */
const BASE64_CHUNK_BYTES = 32_768;

/** Construction proof for PNG images. */
const imageBrand: unique symbol = Symbol("PngImage");

/** Construction proof for system messages. */
const systemMessageBrand: unique symbol = Symbol("SystemMessage");

/** Construction proof for user messages. */
const userMessageBrand: unique symbol = Symbol("UserMessage");

/** Construction proof for complete portable message sequences. */
const messagesBrand: unique symbol = Symbol("ModelMessages");

/** A bounded base64 PNG image carried by a user message. */
export interface PngImage {
  readonly media_type: "image/png";
  readonly data: string;
  readonly [imageBrand]: true;
}

/** The optional leading portable system message. */
export interface SystemMessage {
  readonly role: "system";
  readonly content: string;
  readonly [systemMessageBrand]: true;
}

/** One required portable user message with optional ordered PNG images. */
export interface UserMessage {
  readonly role: "user";
  readonly content: string;
  readonly images?: readonly PngImage[];
  readonly [userMessageBrand]: true;
}

/** One portable model message. */
export type ModelMessage = SystemMessage | UserMessage;

/** A constructed sequence with one or more user messages. */
export type ModelMessages = readonly ModelMessage[] & {
  readonly [messagesBrand]: true;
};

/** Rejects empty portable message text. */
function assertText(content: string): void {
  if (content.length === 0) throw new TypeError("Model message text must be nonempty");
}

/** Encodes the exact byte view as base64 without runtime extensions. */
function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BASE64_CHUNK_BYTES);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

/** Constructs one isolated bounded PNG image from decoded bytes. */
export function createPngImage(bytes: Uint8Array): PngImage {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new TypeError(`PNG image exceeds ${MAX_IMAGE_BYTES} decoded bytes`);
  }
  return {
    media_type: "image/png" as const,
    data: encodeBase64(bytes),
    [imageBrand]: true as const,
  };
}

/** Constructs the optional leading system message. */
export function createSystemMessage(content: string): SystemMessage {
  assertText(content);
  return {
    role: "system" as const,
    content,
    [systemMessageBrand]: true as const,
  };
}

/** Constructs one user message with isolated ordered images. */
export function createUserMessage(content: string, images: readonly PngImage[] = []): UserMessage {
  assertText(content);
  const capturedImages = [...images];
  if (capturedImages.length === 0) {
    return {
      role: "user" as const,
      content,
      [userMessageBrand]: true as const,
    };
  }
  return {
    role: "user" as const,
    content,
    images: capturedImages,
    [userMessageBrand]: true as const,
  };
}

/** Constructs the only portable message ordering accepted by adapters. */
export function createMessages(
  users: readonly UserMessage[],
  system: SystemMessage | null = null,
): ModelMessages {
  if (users.length === 0) throw new TypeError("Model messages require at least one user message");
  const values: ModelMessage[] = system === null ? [...users] : [system, ...users];
  const branded = Object.assign(values, { [messagesBrand]: true as const });
  return branded;
}
