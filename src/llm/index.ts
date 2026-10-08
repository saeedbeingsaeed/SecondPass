import { getEnv, requireEnv, type Env } from "../config.js";
import { GeminiProvider } from "./gemini.js";
import { RateLimitedQueue } from "./queue.js";
import { withRetry } from "./retry.js";
import type { LLMProvider, LLMRequest } from "./types.js";

export type { LLMProvider, LLMRequest, LLMResponse } from "./types.js";

function createRawProvider(env: Env): LLMProvider {
  switch (env.LLM_PROVIDER) {
    case "gemini":
      return new GeminiProvider(
        requireEnv(env, "GEMINI_API_KEY"),
        requireEnv(env, "GEMINI_MODEL"),
        env.LLM_TIMEOUT_MS,
      );
  }
}

// Wraps a provider so every attempt (including retries) waits its turn in the
// shared queue, and rate-limit/server errors are retried with backoff.
export function withRateLimits(
  provider: LLMProvider,
  queue: RateLimitedQueue,
  maxRetries: number,
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
): LLMProvider {
  return {
    name: provider.name,
    model: provider.model,
    complete: (request: LLMRequest) =>
      withRetry(() => queue.run(() => provider.complete(request)), { maxRetries, onRetry }),
  };
}

let shared: LLMProvider | undefined;

export function getLLM(
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
): LLMProvider {
  if (!shared) {
    const env = getEnv();
    const queue = new RateLimitedQueue(env.LLM_MIN_INTERVAL_MS);
    shared = withRateLimits(createRawProvider(env), queue, env.LLM_MAX_RETRIES, onRetry);
  }
  return shared;
}
