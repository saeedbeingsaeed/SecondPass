import { describe, expect, it } from "vitest";
import { RateLimitedQueue } from "../src/llm/queue.js";

// Fake clock: sleeping just advances time, so the test runs instantly.
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => {
      time += ms;
    },
  };
}

describe("RateLimitedQueue", () => {
  it("spaces task starts by at least the interval", async () => {
    const clock = fakeClock();
    const queue = new RateLimitedQueue(1000, clock.now, clock.sleep);
    const starts: number[] = [];
    const task = async () => {
      starts.push(clock.now());
    };
    await Promise.all([queue.run(task), queue.run(task), queue.run(task)]);
    expect(starts).toEqual([0, 1000, 2000]);
  });

  it("keeps going after a task fails", async () => {
    const clock = fakeClock();
    const queue = new RateLimitedQueue(10, clock.now, clock.sleep);
    const failed = queue.run(async () => {
      throw new Error("boom");
    });
    const next = queue.run(async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
