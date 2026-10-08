import { z } from "zod";
import type { Finding } from "../src/review/schema.js";

export const EvalCaseSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must look like "owner/name"'),
  pr: z.number().int().positive(),
  description: z.string().optional(),
  bug: z
    .object({
      file: z.string().min(1),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
    })
    .refine((b) => b.endLine >= b.startLine, "endLine must be >= startLine"),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalCasesSchema = z.array(EvalCaseSchema).min(1);

// A known bug counts as caught if any final finding is in the right file and
// within the line range (widened by `tolerance` lines on each side).
export function catchesBug(findings: Finding[], bug: EvalCase["bug"], tolerance = 0): boolean {
  return findings.some(
    (f) =>
      f.file === bug.file &&
      f.line >= bug.startLine - tolerance &&
      f.line <= bug.endLine + tolerance,
  );
}

export interface CaseResult {
  caseId: string;
  caught: boolean;
  comments: number;
  pass1Findings: number;
  tokens: number;
  llmCalls: number;
  latencyMs: number;
  // True if the model failed on some files, so the numbers are incomplete.
  failed: boolean;
}

export interface RunSummary {
  provider: string;
  model: string;
  secondPass: boolean;
  cases: number;
  recall: number;
  commentsPerPr: number;
  tokensPerPr: number;
  llmCallsPerPr: number;
  latencyPerPrMs: number;
  failedCases: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(
  run: { provider: string; model: string; secondPass: boolean },
  results: CaseResult[],
): RunSummary {
  return {
    ...run,
    cases: results.length,
    recall: results.length ? results.filter((r) => r.caught).length / results.length : 0,
    commentsPerPr: mean(results.map((r) => r.comments)),
    tokensPerPr: mean(results.map((r) => r.tokens)),
    llmCallsPerPr: mean(results.map((r) => r.llmCalls)),
    latencyPerPrMs: mean(results.map((r) => r.latencyMs)),
    failedCases: results.filter((r) => r.failed).length,
  };
}

// Markdown table, so results can be pasted straight into the README.
export function formatSummaryTable(summaries: RunSummary[]): string {
  const header =
    "| Provider | Model | Pass 2 | Recall | Comments / PR | Tokens / PR | LLM calls / PR | Latency / PR | Failed |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |";
  const rows = summaries.map((s) =>
    [
      s.provider,
      `\`${s.model}\``,
      s.secondPass ? "on" : "off",
      `${Math.round(s.recall * 100)}% (${Math.round(s.recall * s.cases)}/${s.cases})`,
      s.commentsPerPr.toFixed(1),
      Math.round(s.tokensPerPr).toLocaleString("en-US"),
      s.llmCallsPerPr.toFixed(1),
      `${(s.latencyPerPrMs / 1000).toFixed(1)}s`,
      String(s.failedCases),
    ].join(" | "),
  );
  return [header, ...rows.map((r) => `| ${r} |`)].join("\n");
}
