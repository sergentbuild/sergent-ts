import { Compile } from "typebox/compile";
import type { Static, TSchema } from "typebox";

import { schemaValidationError } from "../values/index.js";
import type { RunError } from "../values/index.js";
import { assertCanonicalSchema } from "./dialect.js";
import { assertSchemaName } from "./naming.js";

/** The exact named schema sent to a model-backed proposal phase. */
export interface ProposalSchema<Schema extends TSchema = TSchema> {
  readonly name: string;
  readonly json_schema: Schema;
}

/** A successful strict proposal decode. */
export interface SchemaDecodeSuccess<Value> {
  readonly ok: true;
  readonly value: Value;
}

/** A failed strict proposal decode at the model-output boundary. */
export interface SchemaDecodeFailure {
  readonly ok: false;
  readonly error: RunError;
}

/** The strict result of crossing untrusted proposal data. */
export type SchemaDecodeResult<Value> = SchemaDecodeSuccess<Value> | SchemaDecodeFailure;

/** A canonical TypeBox proposal definition and its strict decoder. */
export interface ProposalDefinition<Schema extends TSchema = TSchema> {
  readonly proposal_schema: ProposalSchema<Schema>;

  /** Strictly admits one untrusted value without repair or conversion. */
  decode(value: unknown): SchemaDecodeResult<Static<Schema>>;
}

/** Constructs a canonical proposal definition from one exact TypeBox schema. */
export function createProposalDefinition<const Schema extends TSchema>(
  name: string,
  schema: Schema,
): ProposalDefinition<Schema> {
  assertSchemaName(name);
  assertCanonicalSchema(schema);
  const validator = Compile(schema);
  const proposalSchema: ProposalSchema<Schema> = { name, json_schema: schema };
  return {
    proposal_schema: proposalSchema,
    decode(value: unknown): SchemaDecodeResult<Static<Schema>> {
      if (validator.Check(value)) return { ok: true, value };
      return {
        ok: false,
        error: schemaValidationError(`Proposal ${name} failed strict schema validation`),
      };
    },
  };
}
