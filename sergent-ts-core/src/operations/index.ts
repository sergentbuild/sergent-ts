/**
 * TypeBox-authored Operation definitions, closed registries, strict Plan
 * decoding, and isolated ExecutionPlan-to-Patch compilation.
 */
export { defineOperation } from "./definition.js";
export { compilePatch, createExecutionPlan } from "./plan.js";
export { createOperationRegistry } from "./registry.js";
export type { DefinitionOperation, OperationRegistry } from "./registry.js";
export { admissible, inadmissible } from "./types.js";
export type {
  AdmissibilityAccepted,
  AdmissibilityContext,
  AdmissibilityRejected,
  AdmissibilityResult,
  ExecutionPlan,
  Operation,
  OperationAdmissibility,
  OperationDefinition,
  OperationValue,
  Patch,
  PlanDecodeFailure,
  PlanDecodeResult,
  PlanDecodeSuccess,
  PlanStep,
} from "./types.js";
