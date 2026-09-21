/**
 * Canonical TypeBox proposal definitions, stable naming, and strict typed
 * model-output admission.
 */
export { createProposalDefinition } from "./proposal.js";
export { assertCanonicalSchema } from "./dialect.js";
export type { CanonicalObjectSchema } from "./dialect.js";
export type {
  ProposalDefinition,
  ProposalSchema,
  SchemaDecodeFailure,
  SchemaDecodeResult,
  SchemaDecodeSuccess,
} from "./proposal.js";
