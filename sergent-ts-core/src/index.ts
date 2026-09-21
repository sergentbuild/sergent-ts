/**
 * Algorithmic core of Sergent: canonical proposal and Operation values plus
 * the pure ModelClient, SceneActions, and Recipe contracts.
 */
export { Type } from "typebox";
export type { Static, TSchema } from "typebox";

export {
  createFailedModelAttempt,
  createModelCancellation,
  createModelFailure,
  createModelSuccess,
  createPreAttemptModelFailure,
  createSuccessfulModelAttempt,
  createTransportError,
} from "./model/index.js";
export type {
  CancelledModelAttempts,
  FailedModelAttempt,
  FailedModelAttempts,
  ModelAttempt,
  ModelAttemptTiming,
  ModelCancellation,
  ModelClient,
  ModelFailure,
  ModelFailureResponse,
  ModelIdentity,
  ModelOutcome,
  ModelOutcomeEvidence,
  ModelSuccess,
  ModelTokens,
  ModelUsage,
  NonRetryableFailedModelAttempt,
  NonRetryableTransportFailureKind,
  PreAttemptTransportFailureKind,
  RetryableFailedModelAttempt,
  RetryableTransportFailureKind,
  SuccessfulModelAttempts,
  SuccessfulModelAttempt,
  TransportError,
  TransportFailureKind,
} from "./model/index.js";
export {
  createMessages,
  createModelRequest,
  createModelSettings,
  createPngImage,
  createSystemMessage,
  createUserMessage,
} from "./model-request/index.js";
export type {
  ModelMessage,
  ModelMessages,
  ModelRequest,
  ModelSettings,
  PngImage,
  SystemMessage,
  ThinkingEffort,
  UserMessage,
} from "./model-request/index.js";

export {
  admissible,
  compilePatch,
  createExecutionPlan,
  createOperationRegistry,
  defineOperation,
  inadmissible,
} from "./operations/index.js";
export type {
  AdmissibilityAccepted,
  AdmissibilityContext,
  AdmissibilityRejected,
  AdmissibilityResult,
  DefinitionOperation,
  ExecutionPlan,
  Operation,
  OperationAdmissibility,
  OperationDefinition,
  OperationRegistry,
  OperationValue,
  Patch,
  PlanDecodeFailure,
  PlanDecodeResult,
  PlanDecodeSuccess,
  PlanStep,
} from "./operations/index.js";

export {
  createIntentOnlyRecipe,
  createPlanCapableRecipe,
  PASS_THROUGH_INTENT_PROPOSAL,
  recipeInvalid,
  recipeValid,
} from "./recipe/index.js";
export type {
  IntentOnlyRecipe,
  IntentOnlyRecipeConfig,
  PassThroughIntentProposal,
  PlanCapableRecipe,
  PlanCapableRecipeConfig,
  RecipeContext,
  RecipeMessageContext,
  RecipeValidationAccepted,
  RecipeValidationRejected,
  RecipeValidationResult,
  StopTerminal,
} from "./recipe/index.js";

export { createProposalDefinition } from "./schema/index.js";
export type {
  ProposalDefinition,
  ProposalSchema,
  SchemaDecodeFailure,
  SchemaDecodeResult,
  SchemaDecodeSuccess,
} from "./schema/index.js";

export {
  applied,
  operationFault,
  rebaseConflict,
  rebased,
  verificationReport,
} from "./scene/index.js";
export type {
  ApplyFailure,
  ApplyResult,
  ApplySuccess,
  MindBuf,
  OperationFault,
  RebaseConflict,
  RebaseReplacement,
  RebaseResult,
  SceneActions,
  Target,
  VerificationReport,
} from "./scene/index.js";

export {
  cancelledError,
  captureError,
  internalError,
  mergeConflictError,
  mintOperationId,
  mintRunId,
  observerError,
  patchValidationError,
  runError,
  schemaValidationError,
  stalePatchError,
  validationError,
  validationIssue,
} from "./values/index.js";
export type {
  ContinueIntent,
  Intent,
  IntentFlow,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  OperationId,
  RunError,
  RunId,
  SceneId,
  SceneIdentity,
  StopIntent,
  ValidationIssue,
} from "./values/index.js";
