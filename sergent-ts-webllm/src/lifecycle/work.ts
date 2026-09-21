/** Monotonic deadlines, wall evidence, and cancellable timers for local worker work. */
export interface WorkClock {
  /** Reads elapsed-time authority in milliseconds. */
  now(): number;
  /** Reads the UTC wall timestamp used by completed attempt evidence. */
  timestamp(): string;
  /** Schedules one callback and returns its synchronous removal function. */
  schedule(delayMs: number, callback: () => void): () => void;
}

/** Production Web API clock; browser throttling is handled by elapsed rechecks. */
export const CLOCK: WorkClock = {
  now: () => performance.now(),
  timestamp: () => new Date().toISOString().replace(/\.(\d{3})Z$/, ".$1000Z"),
  schedule: (delayMs, callback) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};

/** Owns the first terminal result and cancellation/deadline resources for one operation. */
export class PendingWork<Result> {
  readonly promise: Promise<Result>;
  #resolve: ((value: Result) => void) | null = null;
  #removeTimer: (() => void) | null = null;
  #deadline = Infinity;

  /** Creates local settlement independently of the native RPC's lifetime. */
  constructor(
    readonly clock: WorkClock,
    private readonly signal: AbortSignal,
    private readonly abort: () => void,
  ) {
    this.promise = new Promise((resolve) => {
      this.#resolve = resolve;
    });
    signal.addEventListener("abort", abort, { once: true });
  }

  /** Reports whether the terminal decision has already been taken. */
  get done(): boolean {
    return this.#resolve === null;
  }

  /** Starts a phase-specific timer from the monotonic authority. */
  deadline(ms: number, timeout: () => void): void {
    this.#removeTimer?.();
    this.#deadline = this.clock.now() + ms;
    this.#removeTimer = this.clock.schedule(ms, timeout);
  }

  /** Rechecks expiry when native work returns before a delayed timer callback. */
  get expired(): boolean {
    return this.clock.now() >= this.#deadline;
  }

  /** Claims one terminal result before disposal or notification can re-enter. */
  settle(value: Result, release: () => void): void {
    const resolve = this.#resolve;
    if (resolve === null) return;
    this.#resolve = null;
    this.#removeTimer?.();
    this.signal.removeEventListener("abort", this.abort);
    release();
    resolve(value);
  }
}
