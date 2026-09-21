import type { TSchema } from "typebox";

import { assertSchemaName } from "./naming.js";

/** Enumerable schema data inspected by the canonical-dialect proof. */
type SchemaRecord = Record<string, unknown>;

/** A root object proven to lie inside the canonical Sergent dialect. */
export interface CanonicalObjectSchema extends TSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, TSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
  readonly description?: string;
  readonly $defs?: Readonly<Record<string, TSchema>>;
}

/** One JSON scalar accepted by a canonical enum. */
type EnumScalar = string | number | boolean | null;

/** Canonical primitive type names. */
const PRIMITIVE_TYPES = new Set(["string", "integer", "number", "boolean", "null"]);

/** Canonical type names. */
const TYPES = new Set(["object", "array", ...PRIMITIVE_TYPES]);

/** Exact local-reference grammar. */
const LOCAL_REFERENCE = /^#\/\$defs\/([A-Za-z0-9_-]{1,64})$/;

/** Returns true for a non-array object. */
function isRecord(value: unknown): value is SchemaRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rejects enumerable keywords outside one node's exact vocabulary. */
function assertKeys(node: SchemaRecord, allowed: ReadonlySet<string>, location: string): void {
  for (const key of Object.keys(node)) {
    if (!allowed.has(key)) {
      throw new TypeError(`Unsupported schema keyword ${key} at ${location}`);
    }
  }
}

/** Checks a schema description when present. */
function assertDescription(node: SchemaRecord, location: string): void {
  if (Object.hasOwn(node, "description") && typeof node.description !== "string") {
    throw new TypeError(`Schema description must be text at ${location}`);
  }
}

/** Returns a stable equality key for one scalar enum member. */
function enumKey(value: string | number | boolean | null): string {
  return `${typeof value}:${JSON.stringify(value)}`;
}

/** Returns true for a finite JSON scalar accepted by an enum. */
function isEnumScalar(value: unknown): value is EnumScalar {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** Checks a scalar enum and its optional declared primitive type. */
function assertEnum(
  node: SchemaRecord,
  location: string,
): asserts node is SchemaRecord & { readonly enum: readonly EnumScalar[] } {
  if (!Array.isArray(node.enum) || node.enum.length === 0) {
    throw new TypeError(`Schema enum must be a nonempty array at ${location}`);
  }
  const seen = new Set<string>();
  for (const value of node.enum) {
    if (!isEnumScalar(value)) {
      throw new TypeError(`Schema enum members must be scalar at ${location}`);
    }
    const key = enumKey(value);
    if (seen.has(key)) {
      throw new TypeError(`Schema enum members must be unique at ${location}`);
    }
    seen.add(key);
  }
}

/** Checks that enum members agree with a declared primitive type. */
function assertEnumType(node: SchemaRecord, type: string, location: string): void {
  if (!Object.hasOwn(node, "enum")) return;
  assertEnum(node, location);
  const matches = (value: unknown): boolean =>
    type === "null"
      ? value === null
      : type === "integer"
        ? typeof value === "number" && Number.isInteger(value)
        : typeof value === type;
  if (!node.enum.every(matches)) {
    throw new TypeError(`Schema enum members must match type ${type} at ${location}`);
  }
}

/** Checks an optional nonnegative array bound. */
function assertItemBound(node: SchemaRecord, key: "minItems" | "maxItems", location: string): void {
  const bound = node[key];
  if (
    bound !== undefined &&
    (!Number.isSafeInteger(bound) || typeof bound !== "number" || bound < 0)
  ) {
    throw new TypeError(`Schema ${key} must be a nonnegative integer at ${location}`);
  }
}

/** Checks that required lists cover every property exactly once. */
function assertRequired(names: readonly string[], value: unknown, location: string): void {
  if (!Array.isArray(value)) {
    throw new TypeError(`Schema objects must be closed with a required list at ${location}`);
  }
  if (
    value.some((name) => typeof name !== "string") ||
    new Set(value).size !== value.length ||
    value.length !== names.length ||
    names.some((name) => !value.includes(name))
  ) {
    throw new TypeError(`Schema required must list every property exactly once at ${location}`);
  }
}

/** Checks one canonical array node and its item schema. */
function assertArray(node: SchemaRecord, location: string): void {
  assertKeys(node, new Set(["type", "items", "minItems", "maxItems", "description"]), location);
  if (!Object.hasOwn(node, "items")) {
    throw new TypeError(`Schema arrays require items at ${location}`);
  }
  assertItemBound(node, "minItems", location);
  assertItemBound(node, "maxItems", location);
  if (
    typeof node.minItems === "number" &&
    typeof node.maxItems === "number" &&
    node.minItems > node.maxItems
  ) {
    throw new TypeError(`Schema minItems exceeds maxItems at ${location}`);
  }
  assertNode(node.items, `${location}.items`, false);
}

/** Checks one canonical object node. */
function assertObject(node: SchemaRecord, location: string, root: boolean): void {
  const keys = ["type", "properties", "required", "additionalProperties", "description"];
  if (root) keys.push("$defs");
  assertKeys(node, new Set(keys), location);
  if (!isRecord(node.properties)) {
    throw new TypeError(`Schema objects require properties at ${location}`);
  }
  if (node.additionalProperties !== false) {
    throw new TypeError(`Schema objects must be closed with a required list at ${location}`);
  }
  const names = Object.keys(node.properties);
  assertRequired(names, node.required, location);
  for (const [name, child] of Object.entries(node.properties)) {
    assertNode(child, `${location}.properties.${name}`, false);
  }
}

/** Dispatches one supported declared type to its exact keyword proof. */
function assertTypedNode(node: SchemaRecord, type: string, location: string, root: boolean): void {
  switch (type) {
    case "object":
      return assertObject(node, location, root);
    case "array":
      return assertArray(node, location);
    case "integer":
    case "number":
      assertNumeric(node, location);
      break;
    default:
      assertKeys(node, new Set(["type", "enum", "description"]), location);
  }
  assertEnumType(node, type, location);
}

/** Checks an optional finite inclusive numeric bound. */
function assertNumericBound(
  node: SchemaRecord,
  key: "minimum" | "maximum",
  location: string,
): void {
  if (Object.hasOwn(node, key) && (typeof node[key] !== "number" || !Number.isFinite(node[key]))) {
    throw new TypeError(`Schema ${key} must be finite at ${location}`);
  }
}

/** Checks one canonical numeric node. */
function assertNumeric(node: SchemaRecord, location: string): void {
  assertKeys(node, new Set(["type", "minimum", "maximum", "enum", "description"]), location);
  assertNumericBound(node, "minimum", location);
  assertNumericBound(node, "maximum", location);
  if (
    typeof node.minimum === "number" &&
    typeof node.maximum === "number" &&
    node.minimum > node.maximum
  ) {
    throw new TypeError(`Schema minimum exceeds maximum at ${location}`);
  }
}

/** Checks one canonical reference node. */
function assertReference(node: SchemaRecord, location: string): void {
  assertKeys(node, new Set(["$ref"]), location);
  if (typeof node.$ref !== "string" || !LOCAL_REFERENCE.test(node.$ref)) {
    throw new TypeError(`Schema reference must be local at ${location}`);
  }
}

/** Checks one canonical union node. */
function assertUnion(node: SchemaRecord, location: string): void {
  assertKeys(node, new Set(["anyOf", "description"]), location);
  if (!Array.isArray(node.anyOf) || node.anyOf.length === 0) {
    throw new TypeError(`Schema anyOf must be nonempty at ${location}`);
  }
  node.anyOf.forEach((branch, index) => assertNode(branch, `${location}.anyOf.${index}`, false));
}

/** Checks one schema node except root definitions and reference resolution. */
function assertNode(value: unknown, location: string, root: boolean): void {
  if (!isRecord(value)) throw new TypeError(`Schema node must be an object at ${location}`);
  assertDescription(value, location);
  if (Object.hasOwn(value, "$ref")) return assertReference(value, location);
  if (Object.hasOwn(value, "anyOf")) return assertUnion(value, location);
  if (!Object.hasOwn(value, "type") && Object.hasOwn(value, "enum")) {
    assertKeys(value, new Set(["enum", "description"]), location);
    return assertEnum(value, location);
  }
  if (typeof value.type !== "string" || !TYPES.has(value.type)) {
    throw new TypeError(`Schema type is unsupported at ${location}`);
  }
  assertTypedNode(value, value.type, location, root);
}

/** Returns the root definition map after checking its member names and schemas. */
function definitions(root: SchemaRecord): SchemaRecord {
  if (!Object.hasOwn(root, "$defs")) return {};
  if (!isRecord(root.$defs)) throw new TypeError("Schema $defs must be an object at root");
  for (const [name, definition] of Object.entries(root.$defs)) {
    assertSchemaName(name);
    assertNode(definition, `$.$defs.${name}`, false);
  }
  return root.$defs;
}

/** Collects a local reference when one schema node is a reference node. */
function collectReference(node: SchemaRecord, found: Set<string>): boolean {
  if (typeof node.$ref !== "string") return false;
  const match = LOCAL_REFERENCE.exec(node.$ref);
  if (match?.[1] !== undefined) found.add(match[1]);
  return true;
}

/** Collects references from the schema-bearing children of one node. */
function collectChildReferences(node: SchemaRecord, found: Set<string>): void {
  if (Array.isArray(node.anyOf)) {
    for (const branch of node.anyOf) collectReferences(branch, found);
    return;
  }
  if (node.type === "object" && isRecord(node.properties)) {
    for (const property of Object.values(node.properties)) collectReferences(property, found);
    return;
  }
  if (node.type === "array") collectReferences(node.items, found);
}

/** Collects local references by following only schema-bearing node fields. */
function collectReferences(value: unknown, found: Set<string>): void {
  if (!isRecord(value) || collectReference(value, found)) return;
  collectChildReferences(value, found);
}

/** Rejects unresolved references anywhere in the canonical schema. */
function assertReferencesResolve(root: SchemaRecord, defs: SchemaRecord): void {
  const refs = new Set<string>();
  collectReferences(root, refs);
  for (const definition of Object.values(defs)) collectReferences(definition, refs);
  for (const name of refs) {
    if (!Object.hasOwn(defs, name)) {
      throw new TypeError(`Schema reference does not resolve: ${name}`);
    }
  }
}

/** Visits one definition dependency while rejecting recursive reference cycles. */
function visitDefinition(
  name: string,
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  visiting: Set<string>,
  visited: Set<string>,
): void {
  if (visiting.has(name)) throw new TypeError(`Schema definitions are recursive at ${name}`);
  if (visited.has(name)) return;
  visiting.add(name);
  for (const dependency of graph.get(name) ?? []) {
    visitDefinition(dependency, graph, visiting, visited);
  }
  visiting.delete(name);
  visited.add(name);
}

/** Rejects direct and indirect cycles among local definitions. */
function assertDefinitionsAcyclic(defs: SchemaRecord): void {
  const graph = new Map<string, ReadonlySet<string>>();
  for (const [name, definition] of Object.entries(defs)) {
    const refs = new Set<string>();
    collectReferences(definition, refs);
    graph.set(name, refs);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const name of graph.keys()) visitDefinition(name, graph, visiting, visited);
}

/** Proves that one TypeBox schema lies in the canonical Sergent dialect. */
export function assertCanonicalSchema(schema: TSchema): asserts schema is CanonicalObjectSchema {
  if (!isRecord(schema) || schema.type !== "object") {
    throw new TypeError("Proposal schema root must be an object");
  }
  assertNode(schema, "$", true);
  const defs = definitions(schema);
  assertReferencesResolve(schema, defs);
  assertDefinitionsAcyclic(defs);
}
