import { z } from "zod";
import { SEVERITIES } from "./schema.js";

// Per-repo settings from .secondpass.yml on the default branch.
// Example:
//   ignore: ["docs/**", "*.snap"]
//   confidenceThreshold: 0.7
//   severities: [bug, security]
export const RepoConfigSchema = z.object({
  ignore: z.array(z.string()).default([]),
  confidenceThreshold: z.number().min(0).max(1).default(0.6),
  // "style" is off unless a repo opts in.
  severities: z.array(z.enum(SEVERITIES)).default(["bug", "security", "performance"]),
});

export type RepoConfig = z.infer<typeof RepoConfigSchema>;

export const DEFAULT_CONFIG: RepoConfig = RepoConfigSchema.parse({});

// Invalid config should not stop reviews: use defaults and say why in the summary.
export function parseRepoConfig(raw: unknown): { config: RepoConfig; warning?: string } {
  const result = RepoConfigSchema.safeParse(raw ?? {});
  if (result.success) return { config: result.data };
  return {
    config: DEFAULT_CONFIG,
    warning: `.secondpass.yml is invalid, so defaults were used: ${z.prettifyError(result.error)}`,
  };
}
