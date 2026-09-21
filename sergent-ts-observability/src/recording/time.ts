import type { ClosedTimeSpan } from "../records/index.js";

/** Wall and monotonic time source shared by one Run Record builder tree. */
export interface RecordClock {
  /** Returns the current wall time. */
  wallNow(): Date;

  /** Returns the current monotonic milliseconds. */
  monotonicNow(): number;
}

/** Default clock used by Run Record builders and harnesses. */
export const SYSTEM_CLOCK: RecordClock = {
  wallNow: (): Date => new Date(),
  monotonicNow: (): number => performance.now(),
};

/** Formats UTC wall time with exactly six fractional digits. */
export function formatTimestamp(value: Date): string {
  return value.toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

/** Mutable timing owner that closes wall and monotonic facts together. */
export class TimeSpanBuilder {
  readonly #clock: RecordClock;
  readonly #startedAt: string;
  readonly #startedMonotonic: number;
  #closed = false;

  /** Starts one timing span from a shared clock. */
  public constructor(clock: RecordClock) {
    this.#clock = clock;
    this.#startedAt = formatTimestamp(clock.wallNow());
    this.#startedMonotonic = clock.monotonicNow();
  }

  /** Closes the span into an inert whole-millisecond value. */
  public close(): ClosedTimeSpan {
    if (this.#closed) throw new TypeError("Time span is already closed");
    const finishedAt = formatTimestamp(this.#clock.wallNow());
    const elapsed = this.#clock.monotonicNow() - this.#startedMonotonic;
    this.#closed = true;
    return {
      started_at: this.#startedAt,
      finished_at: finishedAt,
      duration_ms: Math.max(0, Math.trunc(elapsed)),
    };
  }
}
