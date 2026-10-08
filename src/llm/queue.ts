import { sleep } from "./retry.js";

// Runs tasks one at a time and leaves at least `minIntervalMs` between the
// start of one task and the start of the next. One shared queue per process
// keeps every review, on every repo, inside the provider's requests-per-minute
// limit.
export class RateLimitedQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;

  constructor(
    private readonly minIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const delay = this.lastStart + this.minIntervalMs - this.now();
      if (delay > 0) await this.wait(delay);
      this.lastStart = this.now();
      return task();
    });
    // A failed task must not block the tasks queued behind it.
    this.tail = result.catch(() => undefined);
    return result;
  }
}
