import { randomBytes } from "node:crypto";
import { join } from "node:path";

import type { RunId } from "sergent-ts-core";

import { formatTimestamp, SYSTEM_CLOCK } from "sergent-ts-observability";
import type {
  RecordClock,
  ProgressSnapshot,
  RunObserver,
  SergentResult,
} from "sergent-ts-observability";
import { directValue } from "./direct.js";
import type { FileAdapter } from "./writer.js";
import { NODE_FILE_ADAPTER, RunRecordWriter } from "./writer.js";

/** Active portable line schema marker. */
const RUN_RECORD_SCHEMA = "sergent.run_record.v1";

/** Application and explicit log identity grammar. */
const LOG_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** Formats the shared UTC timestamp for a Run Record filename. */
function formatCompactTimestamp(value: Date): string {
  return formatTimestamp(value).replace(/[-:]/g, "").replace(".", "");
}

/** Optional direct-event correlation supplied by the application. */
export interface EventCorrelation {
  readonly run_id?: string;
  readonly scene_id?: string;
  readonly revision?: number;
}

/** Public synchronous Run Record observer and direct-event harness. */
export interface RunRecordHarness extends RunObserver {
  readonly file_path: string;
  readonly log_id: string;

  /** Records one application-owned direct event. */
  applicationEvent(event: string, payload?: unknown, correlation?: EventCorrelation): void;

  /** Records one user-attributed direct event. */
  userEvent(event: string, payload?: unknown, correlation?: EventCorrelation): void;

  /** Synchronizes and closes the healthy file once. */
  close(): void;
}

/** Dependency bundle used by hermetic writer tests. */
export interface HarnessDependencies {
  readonly clock: RecordClock;
  readonly files: FileAdapter;
  readonly randomHex: () => string;
}

/** Exact data prepared for one portable line before canonical encoding. */
interface LineEnvelope {
  readonly schema_version: typeof RUN_RECORD_SCHEMA;
  readonly timestamp_utc: string;
  readonly activity: "sergent_activity" | "app_activity" | "user_activity";
  readonly event: string;
  readonly payload: unknown;
  readonly run_id?: string;
  readonly scene_id?: string;
  readonly revision?: number;
}

/** Validates one filename component at construction. */
function assertLogName(value: string, label: string): void {
  if (!LOG_NAME.test(value)) throw new TypeError(`${label} has an invalid Run Record name`);
}

/** Validates direct-event name and optional correlation values. */
function assertDirectEvent(event: string, correlation: EventCorrelation): void {
  if (event.trim().length === 0) throw new TypeError("Direct event name must be nonblank");
  if (correlation.run_id !== undefined && correlation.run_id.length === 0) {
    throw new TypeError("Direct event run ID must be nonempty");
  }
  if (correlation.scene_id !== undefined && correlation.scene_id.length === 0) {
    throw new TypeError("Direct event Scene ID must be nonempty");
  }
  if (
    correlation.revision !== undefined &&
    (!Number.isSafeInteger(correlation.revision) || correlation.revision < 0)
  ) {
    throw new TypeError("Direct event revision must be a nonnegative integer");
  }
}

/** Adds only known correlation values to one exact line envelope. */
function withCorrelation(
  envelope: Omit<LineEnvelope, "run_id" | "scene_id" | "revision">,
  correlation: EventCorrelation,
): LineEnvelope {
  return {
    ...envelope,
    ...(correlation.run_id === undefined ? {} : { run_id: correlation.run_id }),
    ...(correlation.scene_id === undefined ? {} : { scene_id: correlation.scene_id }),
    ...(correlation.revision === undefined ? {} : { revision: correlation.revision }),
  };
}

/** One-isolate harness implementation over the synchronous writer owner. */
class SynchronousRunRecordHarness implements RunRecordHarness {
  public readonly file_path: string;
  public readonly log_id: string;
  readonly #clock: RecordClock;
  readonly #writer: RunRecordWriter;
  readonly #started = new Set<RunId>();

  /** Creates the final file immediately and retains no ambient path policy. */
  public constructor(
    directory: string,
    appName: string,
    logId: string | null,
    dependencies: HarnessDependencies,
  ) {
    assertLogName(appName, "Application name");
    const selectedLogId = logId ?? `log_${dependencies.randomHex()}`;
    assertLogName(selectedLogId, "Log ID");
    this.log_id = selectedLogId;
    this.#clock = dependencies.clock;
    const compact = formatCompactTimestamp(dependencies.clock.wallNow());
    this.file_path = join(directory, `${appName}+${selectedLogId}+${compact}.jsonl`);
    this.#writer = new RunRecordWriter(this.file_path, dependencies.files);
  }

  /** Persists only the first acknowledged running started boundary per Run ID. */
  public progress(snapshot: ProgressSnapshot): undefined {
    if (snapshot.stage !== "started" || snapshot.status !== "running") return undefined;
    if (this.#started.has(snapshot.run_id)) return undefined;
    this.#writer.write(
      withCorrelation(
        {
          schema_version: RUN_RECORD_SCHEMA,
          timestamp_utc: formatTimestamp(this.#clock.wallNow()),
          activity: "sergent_activity",
          event: "run.start",
          payload: { snapshot },
        },
        {
          run_id: snapshot.run_id,
          ...(snapshot.scene_id === null ? {} : { scene_id: snapshot.scene_id }),
          revision: snapshot.revision,
        },
      ),
    );
    this.#started.add(snapshot.run_id);
    return undefined;
  }

  /** Persists one complete Run Record for each terminal callback. */
  public finished(result: SergentResult): undefined {
    const record = result.run_record;
    const revision = record.scene.revision_after ?? record.scene.revision_before;
    this.#writer.write(
      withCorrelation(
        {
          schema_version: RUN_RECORD_SCHEMA,
          timestamp_utc: formatTimestamp(this.#clock.wallNow()),
          activity: "sergent_activity",
          event: "run.end",
          payload: { run_record: record },
        },
        {
          run_id: record.run_id,
          scene_id: record.scene.scene_id,
          revision,
        },
      ),
    );
    return undefined;
  }

  /** Records one application-owned direct event. */
  public applicationEvent(
    event: string,
    payload?: unknown,
    correlation: EventCorrelation = {},
  ): void {
    this.directEvent("app_activity", event, payload, correlation);
  }

  /** Records one user-attributed direct event. */
  public userEvent(event: string, payload?: unknown, correlation: EventCorrelation = {}): void {
    this.directEvent("user_activity", event, payload, correlation);
  }

  /** Closes the synchronous file owner idempotently. */
  public close(): void {
    this.#writer.close();
  }

  /** Converts and persists a direct event without framework-boundary synthesis. */
  private directEvent(
    activity: "app_activity" | "user_activity",
    event: string,
    payload: unknown,
    correlation: EventCorrelation,
  ): void {
    this.#writer.ensureAvailable();
    assertDirectEvent(event, correlation);
    const projected = payload === undefined ? {} : directValue(payload);
    this.#writer.write(
      withCorrelation(
        {
          schema_version: RUN_RECORD_SCHEMA,
          timestamp_utc: formatTimestamp(this.#clock.wallNow()),
          activity,
          event,
          payload: projected,
        },
        correlation,
      ),
    );
  }
}

/** Creates a production Run Record harness with an immediate exclusive file. */
export function createRunRecordHarness(
  directory: string,
  appName: string,
  logId: string | null = null,
): RunRecordHarness {
  return createRunRecordHarnessWithDependencies(directory, appName, logId, {
    clock: SYSTEM_CLOCK,
    files: NODE_FILE_ADAPTER,
    randomHex: (): string => randomBytes(16).toString("hex"),
  });
}

/** Creates a Run Record harness with deterministic private test dependencies. */
export function createRunRecordHarnessWithDependencies(
  directory: string,
  appName: string,
  logId: string | null,
  dependencies: HarnessDependencies,
): RunRecordHarness {
  return new SynchronousRunRecordHarness(directory, appName, logId, dependencies);
}
