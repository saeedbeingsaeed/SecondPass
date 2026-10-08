import type { ChangedFile } from "../github/pr.js";
import type { LLMProvider } from "../llm/index.js";

// Rough budget for milestone 1; replaced by real per-file token caps later.
const MAX_DIFF_CHARS = 40_000;

const SYSTEM_PROMPT = `You summarize GitHub pull requests for reviewers.
Write 2-4 plain sentences describing what the change does and why it matters.
Do not list files one by one. Do not use headings. Do not invent details not in the diff.`;

export function buildDiffText(files: ChangedFile[], maxChars = MAX_DIFF_CHARS) {
  let text = "";
  let truncated = false;
  for (const file of files) {
    const section = `--- ${file.filename} (${file.status})\n${file.patch ?? "(no textual diff)"}\n\n`;
    if (text.length + section.length > maxChars) {
      truncated = true;
      break;
    }
    text += section;
  }
  return { text, truncated };
}

export interface SummaryResult {
  summary: string;
  truncated: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export async function summarizePullRequest(
  llm: LLMProvider,
  title: string,
  files: ChangedFile[],
): Promise<SummaryResult> {
  const { text, truncated } = buildDiffText(files);
  const response = await llm.complete({
    system: SYSTEM_PROMPT,
    prompt: `Pull request title: ${title}\n\nDiff:\n${text}`,
  });
  return {
    summary: response.text.trim(),
    truncated,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    latencyMs: response.latencyMs,
  };
}

export function formatSummaryComment(
  result: SummaryResult,
  meta: { headSha: string; model: string; fileCount: number },
): string {
  const lines = ["### SecondPass review", "", result.summary, ""];
  if (result.truncated) {
    lines.push("> Note: this PR is large, so only part of the diff was read.", "");
  }
  const tokens = (result.inputTokens + result.outputTokens).toLocaleString("en-US");
  lines.push(
    `<sub>Commit ${meta.headSha.slice(0, 7)} · ${meta.fileCount} files · ${meta.model} · ` +
      `${tokens} tokens · ${(result.latencyMs / 1000).toFixed(1)}s</sub>`,
  );
  return lines.join("\n");
}
