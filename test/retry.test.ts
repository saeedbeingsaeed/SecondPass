import { describe, expect, it, vi } from "vitest";
import { backoffDelay, withRetry } from "../src/llm/retry.js";
import { LLMError } from "../src/llm/types.js";

const noSleep = () => Promise.resolve();

describe("backoffDelay", () => {
  it("doubles each attempt and caps at the max", () => {
    expect([0, 1, 2, 3].map((a) => backoffDelay(a, 1000, 5000))).toEqual([1000, 2000, 4000, 5000]);
  });

  it("waits at least as long as the provider asked", () => {
    expect(backoffDelay(0, 1000, 60_000, 27_000)).toBe(27_000);
  });
});

describe("withRetry", () => {
  it("retries rate-limit errors and then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LLMError("slow down", 429))
      .mockRejectedValueOnce(new LLMError("overloaded", 503))
      .mockResolvedValue("ok");
    await expect(withRetry(fn, { maxRetries: 3, sleep: noSleep })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors like a bad API key", async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError("bad key", 400));
    await expect(withRetry(fn, { maxRetries: 3, sleep: noSleep })).rejects.toThrow("bad key");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries", async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError("slow down", 429));
    await expect(withRetry(fn, { maxRetries: 2, sleep: noSleep })).rejects.toThrow("slow down");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("gives up at once when the provider asks for a wait longer than the max (daily quota)", async () => {
    const fn = vi.fn().mockRejectedValue(new LLMError("quota", 429, 20 * 60 * 60 * 1000));
    await expect(withRetry(fn, { maxRetries: 4, sleep: noSleep })).rejects.toThrow("quota");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("uses the provider's retry hint as the delay", async () => {
    const sleep = vi.fn(noSleep);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new LLMError("slow down", 429, 30_000))
      .mockResolvedValue("ok");
    await withRetry(fn, { maxRetries: 1, sleep });
    expect(sleep).toHaveBeenCalledWith(30_000);
  });
});
