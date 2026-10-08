import { LLMError } from "./types.js";

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isRetryable(error: unknown): boolean {
  return error instanceof LLMError ? error.retryable : false;
}

// Exponential backoff: 2s, 4s, 8s, ... capped at maxDelayMs. If the provider
// says how long to wait, we wait at least that long.
export function backoffDelay(attempt: number, base: number, max: number, hintMs?: number): number {
  const exponential = Math.min(max, base * 2 ** attempt);
  return Math.min(max, Math.max(exponential, hintMs ?? 0));
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { maxRetries, baseDelayMs = 2_000, maxDelayMs = 60_000, sleep: wait = sleep } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= maxRetries || !isRetryable(error)) throw error;
      const hint = error instanceof LLMError ? error.retryAfterMs : undefined;
      const delay = backoffDelay(attempt, baseDelayMs, maxDelayMs, hint);
      options.onRetry?.(attempt + 1, delay, error);
      await wait(delay);
    }
  }
}
