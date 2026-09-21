import type { WorkClock } from "./lifecycle/index.js";

/** Deterministic timers can either fire or be delayed while elapsed time advances. */
export class FakeClock implements WorkClock {
  #tick = 0;
  readonly #timers = new Map<() => void, number>();
  /** Reads the manually advanced monotonic clock. */
  now(): number {
    return this.#tick;
  }
  /** Supplies stable, advancing wall evidence for completed attempts. */
  timestamp(): string {
    return new Date(1_783_123_200_000 + this.#tick).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
  }
  /** Records a bounded timer without scheduling real work. */
  schedule(delay: number, callback: () => void): () => void {
    this.#timers.set(callback, this.#tick + delay);
    return () => {
      this.#timers.delete(callback);
    };
  }
  /** Advances elapsed time, optionally holding timer delivery for deadline rechecks. */
  advance(ms: number, fire = true): void {
    this.#tick += ms;
    if (!fire) return;
    for (const [callback, deadline] of this.#timers) {
      if (deadline <= this.#tick) {
        this.#timers.delete(callback);
        callback();
      }
    }
  }
}
