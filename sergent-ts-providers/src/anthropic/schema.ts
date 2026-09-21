import type { ProposalSchema } from "sergent-ts-core";

/** Enumerable canonical schema node inspected for Anthropic incompatibilities. */
type SchemaNode = Record<string, unknown>;

/** Narrows canonical schema children while traversing the SDK compatibility seam. */
function isNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Visits the values of a schema map such as properties or definitions. */
function visitMap(value: unknown, definitions: SchemaNode, visited: Set<SchemaNode>): boolean {
  if (!isNode(value)) return false;
  return Object.values(value).some((child) => incompatibleNode(child, definitions, visited));
}

/** Visits the members of a canonical schema union. */
function visitUnion(value: unknown, definitions: SchemaNode, visited: Set<SchemaNode>): boolean {
  if (!Array.isArray(value)) return false;
  return value.some((child) => incompatibleNode(child, definitions, visited));
}

/** Resolves and visits one local canonical reference without rewriting it. */
function visitReference(
  value: unknown,
  definitions: SchemaNode,
  visited: Set<SchemaNode>,
): boolean {
  if (typeof value !== "string" || !value.startsWith("#/$defs/")) return false;
  return incompatibleNode(definitions[value.slice(8)], definitions, visited);
}

/** Detects unsupported numeric and array keywords on one schema node. */
function hasUnsupportedKeyword(value: SchemaNode): boolean {
  if (Object.hasOwn(value, "minimum") || Object.hasOwn(value, "maximum")) return true;
  if (Object.hasOwn(value, "maxItems")) return true;
  return typeof value.minItems === "number" && value.minItems > 1;
}

/** Detects one Anthropic-incompatible keyword in a canonical schema graph. */
function incompatibleNode(
  value: unknown,
  definitions: SchemaNode,
  visited: Set<SchemaNode>,
): boolean {
  if (!isNode(value) || visited.has(value)) return false;
  visited.add(value);
  if (hasUnsupportedKeyword(value)) return true;
  if (visitReference(value.$ref, definitions, visited)) return true;
  if (incompatibleNode(value.items, definitions, visited)) return true;
  if (visitUnion(value.anyOf, definitions, visited)) return true;
  return visitMap(value.properties, definitions, visited);
}

/** Returns true only when Anthropic can carry the canonical schema unchanged. */
export function isAnthropicSchemaCompatible(proposal: ProposalSchema): boolean {
  const root = proposal.json_schema;
  if (!isNode(root)) throw new TypeError("Constructed proposal schema must be an object");
  const definitions = isNode(root.$defs) ? root.$defs : {};
  const visited = new Set<SchemaNode>();
  if (incompatibleNode(root, definitions, visited)) return false;
  return !visitMap(definitions, definitions, visited);
}
