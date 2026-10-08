import { z } from "zod";

// Settings SecondPass reads from the environment. Probot reads its own
// variables (APP_ID, PRIVATE_KEY, WEBHOOK_SECRET, ...) separately.
const EnvSchema = z.object({
  LLM_PROVIDER: z.enum(["gemini"]).default("gemini"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).optional(),
  // Minimum gap between two LLM requests. 13s keeps us under 5 requests/minute.
  LLM_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(13_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(4),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).default(120_000),
  // Code sent to the model in one request. Keep it under the provider's tokens/minute limit.
  LLM_MAX_TOKENS_PER_CALL: z.coerce.number().int().min(1_000).default(15_000),

  // Large-PR limits. Files past these are skipped and listed in the summary.
  MAX_FILES_PER_REVIEW: z.coerce.number().int().min(1).default(25),
  MAX_INPUT_TOKENS_PER_REVIEW: z.coerce.number().int().min(1_000).default(60_000),
  // Pass 2: a second LLM call that critiques each finding and drops weak ones.
  REVIEW_SECOND_PASS: z.stringbool().default(true),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

// Parsed lazily so Probot's first-run setup page works before any keys exist.
export function getEnv(): Env {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}

export function requireEnv<K extends keyof Env>(env: Env, key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === "") {
    throw new Error(`Missing required environment variable ${String(key)}. See .env.example.`);
  }
  return value as NonNullable<Env[K]>;
}
