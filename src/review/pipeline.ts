import type { LLMProvider } from "../llm/index.js";
import { isCommentable, parsePatch, type ParsedPatch } from "./diff.js";
import {
  buildReviewPrompt,
  invalidOutputFollowUp,
  renderFile,
  REVIEW_SYSTEM_PROMPT,
} from "./prompts.js";
import { parseReviewResponse, type Finding } from "./schema.js";

// The review pipeline knows nothing about GitHub: it takes files in and gives
// findings out. The webhook handler posts the results; the eval script only
// measures them.

export interface FileForReview {
  path: string;
  patch: string;
  // Full new contents of the file, when we could fetch it.
  content?: string;
}

export interface ReviewInput {
  title: string;
  files: FileForReview[];
}

export interface ReviewStats {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  // Time spent waiting on the model, summed over calls.
  llmLatencyMs: number;
  // Findings the model returned that were malformed or pointed outside the diff.
  droppedInvalid: number;
  droppedUnmapped: number;
  // Files whose batch failed even after retrying (bad output or provider down).
  failedFiles: string[];
  // Why batches failed (provider errors, invalid output). Never contains code.
  errors: string[];
}

export interface ReviewOutput {
  summary: string;
  findings: Finding[];
  stats: ReviewStats;
}

// Roughly 15k tokens of code per request (about 4 characters per token).
const MAX_BATCH_CHARS = 60_000;

interface RenderedFile {
  path: string;
  text: string;
}

// Groups files into as few requests as possible without exceeding the budget.
// A file larger than the budget gets a request of its own.
export function batchFiles(files: RenderedFile[], maxChars = MAX_BATCH_CHARS): RenderedFile[][] {
  const batches: RenderedFile[][] = [];
  let current: RenderedFile[] = [];
  let size = 0;
  for (const file of files) {
    if (current.length > 0 && size + file.text.length > maxChars) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += file.text.length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/^b\//, "");
}

// Keeps only findings that land on a line GitHub will accept a comment on,
// and collapses duplicates (same file, line and severity) to the most confident.
export function mapFindings(
  findings: Finding[],
  patches: Map<string, ParsedPatch>,
): { kept: Finding[]; dropped: number } {
  const byKey = new Map<string, Finding>();
  let dropped = 0;
  for (const raw of findings) {
    const finding = { ...raw, file: normalizePath(raw.file) };
    const parsed = patches.get(finding.file);
    if (!parsed || !isCommentable(parsed, finding.line)) {
      dropped++;
      continue;
    }
    const key = `${finding.file}:${finding.line}:${finding.severity}`;
    const existing = byKey.get(key);
    if (!existing || finding.confidence > existing.confidence) byKey.set(key, finding);
  }
  return { kept: [...byKey.values()], dropped };
}

export async function runReview(llm: LLMProvider, input: ReviewInput): Promise<ReviewOutput> {
  const stats: ReviewStats = {
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    llmLatencyMs: 0,
    droppedInvalid: 0,
    droppedUnmapped: 0,
    failedFiles: [],
    errors: [],
  };
  const patches = new Map<string, ParsedPatch>();
  const rendered: RenderedFile[] = [];
  for (const file of input.files) {
    const parsed = parsePatch(file.patch);
    patches.set(file.path, parsed);
    rendered.push({ path: file.path, text: renderFile(file.path, parsed, file.content) });
  }

  const summaries: string[] = [];
  const allFindings: Finding[] = [];
  for (const batch of batchFiles(rendered)) {
    const prompt = buildReviewPrompt(
      input.title,
      batch.map((f) => f.text),
    );
    const result = await reviewBatch(llm, prompt, stats);
    if (!result) {
      stats.failedFiles.push(...batch.map((f) => f.path));
      continue;
    }
    if (result.summary) summaries.push(result.summary);
    allFindings.push(...result.findings);
    stats.droppedInvalid += result.invalidCount;
  }

  const { kept, dropped } = mapFindings(allFindings, patches);
  stats.droppedUnmapped = dropped;
  return { summary: summaries.join(" "), findings: kept, stats };
}

// One request, plus one retry if the reply is not valid JSON in our schema.
// Returns undefined when the batch cannot be reviewed; the caller reports it.
async function reviewBatch(llm: LLMProvider, prompt: string, stats: ReviewStats) {
  let followUp = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      const response = await llm.complete({
        system: REVIEW_SYSTEM_PROMPT,
        prompt: prompt + followUp,
        json: true,
      });
      stats.llmCalls++;
      stats.inputTokens += response.inputTokens;
      stats.outputTokens += response.outputTokens;
      stats.llmLatencyMs += response.latencyMs;
      text = response.text;
    } catch (error) {
      // The provider wrapper already retried rate limits and server errors.
      stats.errors.push((error as Error).message);
      return undefined;
    }
    const parsed = parseReviewResponse(text);
    if (parsed.ok) return parsed;
    followUp = invalidOutputFollowUp(parsed.error);
    if (attempt === 1) stats.errors.push(`Invalid model output: ${parsed.error.slice(0, 200)}`);
  }
  return undefined;
}
