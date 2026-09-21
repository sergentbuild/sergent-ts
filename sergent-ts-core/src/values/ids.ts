/** A framework-minted run identifier. */
export type RunId = `run_${string}`;

/** A framework-minted operation identifier. */
export type OperationId = `op_${string}`;

/** An application-owned scene identifier using the framework grammar. */
export type SceneId = `${string}_${string}`;

/** The identity of one observed Scene revision. */
export interface SceneIdentity {
  readonly scene_id: SceneId;
  readonly revision: number;
}

/** Encodes bytes as lowercase hexadecimal without runtime extensions. */
function encodeHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Mints a cryptographically random run identifier. */
export function mintRunId(): RunId {
  return `run_${encodeHex(crypto.getRandomValues(new Uint8Array(16)))}`;
}

/** Mints a cryptographically random operation identifier. */
export function mintOperationId(): OperationId {
  return `op_${encodeHex(crypto.getRandomValues(new Uint8Array(16)))}`;
}
