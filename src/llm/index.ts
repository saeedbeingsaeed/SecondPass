import { getEnv, providerSettings, type ProviderName } from "../config.js";
import { GeminiProvider } from "./gemini.js";
import { GroqProvider } from "./groq.js";
import { RateLimitedQueue } from "./queue.js";
import { withRetry } from "./retry.js";
import type { LLMProvider, LLMRequest } from "./types.js";

export type { LLMProvider, LLMRequest, LLMResponse } from "./types.js";

// Wraps a provider so every attempt (including retries) waits its turn in the
// shared queue, and rate-limit/server errors are retried with backoff.
export function withRateLimits(
  provider: LLMProvider,
  queue: RateLimitedQueue,
  maxRetries: number,
): LLMProvider {
  return {
    name: provider.name,
    model: provider.model,
    complete: (request: LLMRequest) =>
      withRetry(() => queue.run(() => provider.complete(request)), {
        maxRetries,
        onRetry: request.onRetry,
      }),
  };
}

export interface ConfiguredLLM {
  llm: LLMProvider;
  maxTokensPerCall: number;
}

// One instance (and so one rate-limit queue) per provider for the whole
// process, because free-tier limits apply to the account, not to a review.
const instances = new Map<ProviderName, ConfiguredLLM>();

export function getLLM(name?: ProviderName): ConfiguredLLM {
  const env = getEnv();
  const provider = name ?? env.LLM_PROVIDER;
  let instance = instances.get(provider);
  if (!instance) {
    const settings = providerSettings(env, provider);
    const raw =
      provider === "gemini"
        ? new GeminiProvider(settings.apiKey, settings.model, env.LLM_TIMEOUT_MS)
        : new GroqProvider(settings.apiKey, settings.model, env.LLM_TIMEOUT_MS);
    const queue = new RateLimitedQueue(settings.minIntervalMs);
    instance = {
      llm: withRateLimits(raw, queue, env.LLM_MAX_RETRIES),
      maxTokensPerCall: settings.maxTokensPerCall,
    };
    instances.set(provider, instance);
  }
  return instance;
}
