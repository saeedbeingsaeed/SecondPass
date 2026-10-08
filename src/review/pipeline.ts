import { createHash } from "node:crypto";
import type { LLMProvider } from "../llm/index.js";
import { isCommentable, parsePatch, type ParsedPatch } from "./diff.js";
import { estimateTokens, type SkippedFile } from "./files.js";
import { applyVerdicts, filterByConfidence, filterBySeverity } from "./filter.js";
import {
  buildCritiquePrompt,
  buildReviewPrompt,
  codeSnippet,
  CRITIQUE_SYSTEM_PROMPT,
  invalidOutputFollowUp,
  renderFile,
  REVIEW_SYSTEM_PROMPT,
} from "./prompts.js";
import {
  parseCritiqueResponse,
  parseReviewResponse,
  type Finding,
  type ParseResult,
  type Severity,
} from "./schema.js";

// The review pipeline knows nothing about GitHub: files go in, findings come
// out. The webhook handler posts the results; the eval script only measures them.

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

export interface ReviewOptions {
  secondPass: boolean;
  confidenceThreshold: number;
  severities: Severity[];
  // Budget for code sent in pass 1, across all requests.
  maxInputTokens: number;
  // Budget for code in a single request (keep under the provider's tokens/minute).
  maxTokensPerCall: number;
}

export interface ReviewFinding extends Finding {
  // Stable ID for "the same issue on the same code", used to avoid reposting
  // a comment when the PR is updated.
  fingerprint: string;
}

export interface ReviewStats {
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  // Time spent waiting on the model, summed over calls.
  llmLatencyMs: number;
  // How many findings each step started with or removed.
  pass1Findings: number;
  droppedInvalid: number;
  droppedUnmapped: number;
  droppedSeverity: number;
  droppedSecondPass: number;
  droppedLowConfidence: number;
  // Files whose request failed even after retrying (bad output or provider down).
  failedFiles: string[];
  secondPassFailed: boolean;
  // Why requests failed. Never contains code.
  errors: string[];
}

export interface ReviewOutput {
  summary: string;
  findings: ReviewFinding[];
  // Files left out because of the token budget.
  skipped: SkippedFile[];
  stats: ReviewStats;
}

interface PreparedFile extends FileForReview {
  parsed: ParsedPatch;
  text: string;
}

// Groups files into as few requests as possible without exceeding the budget.
// A file larger than the budget gets a request of its own.
export function batchFiles<T extends { text: string }>(files: T[], maxTokens: number): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const file of files) {
    const tokens = estimateTokens(file.text);
    if (current.length > 0 && size + tokens > maxTokens) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(file);
    size += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "").replace(/^b\//, "");
}

export function fingerprint(file: string, severity: string, lineText: string): string {
  const normalized = lineText.trim().replace(/\s+/g, " ");
  return createHash("sha256")
    .update(`${file}\0${severity}\0${normalized}`)
    .digest("hex")
    .slice(0, 16);
}

// Keeps only findings that land on a line GitHub will accept a comment on,
// and collapses duplicates (same file, line and severity) to the most confident.
export function mapFindings(
  findings: Finding[],
  patches: Map<string, ParsedPatch>,
): { kept: ReviewFinding[]; dropped: number } {
  const byKey = new Map<string, ReviewFinding>();
  let dropped = 0;
  for (const raw of findings) {
    const file = normalizePath(raw.file);
    const parsed = patches.get(file);
    if (!parsed || !isCommentable(parsed, raw.line)) {
      dropped++;
      continue;
    }
    const finding: ReviewFinding = {
      ...raw,
      file,
      fingerprint: fingerprint(file, raw.severity, parsed.lines.get(raw.line) ?? ""),
    };
    const key = `${file}:${raw.line}:${raw.severity}`;
    const existing = byKey.get(key);
    if (!existing || finding.confidence > existing.confidence) byKey.set(key, finding);
  }
  return { kept: [...byKey.values()], dropped };
}

// Asks for JSON, validates it, and retries once with the validation error.
// Returns undefined when it still fails; callers degrade instead of crashing.
async function completeJson<T>(
  llm: LLMProvider,
  system: string,
  prompt: string,
  parse: (text: string) => ParseResult<T>,
  stats: ReviewStats,
): Promise<T | undefined> {
  let followUp = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    let text: string;
    try {
      const response = await llm.complete({ system, prompt: prompt + followUp, json: true });
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
    const parsed = parse(text);
    if (parsed.ok) return parsed.value;
    followUp = invalidOutputFollowUp(parsed.error);
    if (attempt === 1) stats.errors.push(`Invalid model output: ${parsed.error.slice(0, 200)}`);
  }
  return undefined;
}

// Up to this many findings are judged in one pass 2 request.
const CRITIQUE_BATCH = 15;

async function critique(
  llm: LLMProvider,
  title: string,
  findings: ReviewFinding[],
  files: Map<string, PreparedFile>,
  stats: ReviewStats,
): Promise<ReviewFinding[]> {
  const kept: ReviewFinding[] = [];
  for (let start = 0; start < findings.length; start += CRITIQUE_BATCH) {
    const chunk = findings.slice(start, start + CRITIQUE_BATCH);
    const items = chunk.map((f, i) => {
      const file = files.get(f.file)!;
      return { ...f, id: i + 1, snippet: codeSnippet(file.parsed, file.content, f.line) };
    });
    const verdicts = await completeJson(
      llm,
      CRITIQUE_SYSTEM_PROMPT,
      buildCritiquePrompt(title, items),
      parseCritiqueResponse,
      stats,
    );
    if (!verdicts) {
      // Pass 2 is a filter; if it is unavailable, fall back to pass 1 results
      // (the confidence threshold still applies) rather than posting nothing.
      stats.secondPassFailed = true;
      kept.push(...chunk);
      continue;
    }
    kept.push(...applyVerdicts(chunk, verdicts));
  }
  return kept;
}

export async function runReview(
  llm: LLMProvider,
  input: ReviewInput,
  options: ReviewOptions,
): Promise<ReviewOutput> {
  const stats: ReviewStats = {
    llmCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    llmLatencyMs: 0,
    pass1Findings: 0,
    droppedInvalid: 0,
    droppedUnmapped: 0,
    droppedSeverity: 0,
    droppedSecondPass: 0,
    droppedLowConfidence: 0,
    failedFiles: [],
    secondPassFailed: false,
    errors: [],
  };

  // Render every file, then keep files in order until the token budget is used.
  const prepared = new Map<string, PreparedFile>();
  const skipped: SkippedFile[] = [];
  let budget = options.maxInputTokens;
  for (const file of input.files) {
    const parsed = parsePatch(file.patch);
    const text = renderFile(file.path, parsed, file.content);
    const tokens = estimateTokens(text);
    if (tokens > budget) {
      skipped.push({ path: file.path, reason: "token limit" });
      continue;
    }
    budget -= tokens;
    prepared.set(file.path, { ...file, parsed, text });
  }

  // Pass 1: generate findings.
  const summaries: string[] = [];
  const pass1: Finding[] = [];
  for (const batch of batchFiles([...prepared.values()], options.maxTokensPerCall)) {
    const result = await completeJson(
      llm,
      REVIEW_SYSTEM_PROMPT,
      buildReviewPrompt(
        input.title,
        batch.map((f) => f.text),
      ),
      parseReviewResponse,
      stats,
    );
    if (!result) {
      stats.failedFiles.push(...batch.map((f) => f.path));
      continue;
    }
    if (result.summary) summaries.push(result.summary);
    pass1.push(...result.findings);
    stats.droppedInvalid += result.invalidCount;
  }
  stats.pass1Findings = pass1.length;

  const patches = new Map([...prepared].map(([path, f]) => [path, f.parsed]));
  const mapped = mapFindings(pass1, patches);
  stats.droppedUnmapped = mapped.dropped;

  // Drop unwanted severities before pass 2 so we don't pay to critique them.
  let findings = filterBySeverity(mapped.kept, options.severities);
  stats.droppedSeverity = mapped.kept.length - findings.length;

  // Pass 2: critique each finding and drop what can't be justified.
  if (options.secondPass && findings.length > 0) {
    const before = findings.length;
    findings = await critique(llm, input.title, findings, prepared, stats);
    stats.droppedSecondPass = before - findings.length;
  }

  const confident = filterByConfidence(findings, options.confidenceThreshold);
  stats.droppedLowConfidence = findings.length - confident.length;

  return { summary: summaries.join(" "), findings: confident, skipped, stats };
}
