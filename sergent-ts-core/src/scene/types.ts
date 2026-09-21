import type { Operation, Patch } from "../operations/index.js";
import type {
  Intent,
  JsonObject,
  OperationId,
  RunError,
  SceneIdentity,
  ValidationIssue,
} from "../values/index.js";

/** An application-created immutable hot-context snapshot for one Run. */
export interface MindBuf {
  /** Renders the already-curated snapshot for model context. */
  export(): string;
}

/** An application-owned readonly bounded Scene selection. */
export type Target = Readonly<object>;

/** A successful synchronous Scene application. */
export interface ApplySuccess<Scene> {
  readonly ok: true;
  readonly scene: Scene;
}

/** One application-reported failure while applying an Operation. */
export interface OperationFault {
  readonly operation_id: OperationId;
  readonly error: RunError;
}

/** A failed synchronous Scene application. */
export interface ApplyFailure {
  readonly ok: false;
  readonly fault: OperationFault;
}

/** The expected result of applying a complete ordered Patch. */
export type ApplyResult<Scene> = ApplySuccess<Scene> | ApplyFailure;

/** Complete application verification evidence for a Scene transition. */
export interface VerificationReport {
  readonly issues: readonly ValidationIssue[];
}

/** A deterministic replacement Patch and application rebase facts. */
export interface RebaseReplacement<OperationData = Operation> {
  readonly kind: "replacement";
  readonly patch: Patch<OperationData>;
  readonly metadata: JsonObject;
}

/** An application-declared deterministic merge conflict. */
export interface RebaseConflict {
  readonly kind: "conflict";
  readonly error: RunError;
}

/** The expected result of application-defined deterministic Patch rebase. */
export type RebaseResult<OperationData = Operation> =
  | RebaseReplacement<OperationData>
  | RebaseConflict;

/** Deterministic application seams over one concrete Scene representation. */
export interface SceneActions<
  Scene,
  TargetValue extends Target,
  IntentValue extends Intent,
  OperationData = Operation,
> {
  /** Returns the authoritative identity embedded in or beside a Scene. */
  identity(scene: Scene): SceneIdentity;

  /** Creates an isolated Scene candidate for deterministic work. */
  clone(scene: Scene): Scene;

  /** Selects the one bounded Target for a Run, or reports its absence. */
  selectTarget(scene: Scene): TargetValue | null;

  /** Checks whether the exact selected Target exists in a supplied Scene. */
  targetExists(scene: Scene, target: TargetValue): boolean;

  /** Applies one complete Patch to an isolated evolving Scene candidate. */
  apply(
    scene: Scene,
    patch: Patch<OperationData>,
    intent: IntentValue,
    target: TargetValue,
  ): ApplyResult<Scene>;

  /** Checks complete before-and-after application invariants. */
  verify(before: Scene, after: Scene, intent: IntentValue, target: TargetValue): VerificationReport;

  /** Replaces operands deterministically after shared live state advances. */
  rebase?(
    patch: Patch<OperationData>,
    base: Scene,
    current: Scene,
    intent: IntentValue,
    target: TargetValue,
  ): RebaseResult<OperationData>;
}

/** Constructs a successful synchronous Scene application result. */
export function applied<Scene>(scene: Scene): ApplySuccess<Scene> {
  return { ok: true, scene };
}

/** Constructs one correlated application Operation fault. */
export function operationFault(operationId: OperationId, error: RunError): ApplyFailure {
  return { ok: false, fault: { operation_id: operationId, error } };
}

/** Constructs complete immutable Scene verification evidence. */
export function verificationReport(issues: readonly ValidationIssue[] = []): VerificationReport {
  return { issues: [...issues] };
}

/** Constructs an accepted deterministic replacement Patch. */
export function rebased<OperationData>(
  patch: Patch<OperationData>,
  metadata: JsonObject = {},
): RebaseReplacement<OperationData> {
  return { kind: "replacement", patch, metadata: structuredClone(metadata) };
}

/** Constructs an application-declared deterministic merge conflict. */
export function rebaseConflict(error: RunError): RebaseConflict {
  return { kind: "conflict", error };
}
