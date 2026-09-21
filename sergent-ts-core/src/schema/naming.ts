/** Stable schema names accepted by Sergent. */
const SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Rejects an invalid stable proposal or definition name. */
export function assertSchemaName(name: string): void {
  if (!SCHEMA_NAME.test(name)) {
    throw new TypeError(
      "Schema names must contain 1 through 64 ASCII letters, digits, underscores, or hyphens",
    );
  }
}
