/** A JSON scalar value. */
export type JsonPrimitive = string | number | boolean | null;

/** A readonly JSON object. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A readonly value representable by JSON. */
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
