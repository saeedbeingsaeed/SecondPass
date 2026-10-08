import { isCommentable, type ParsedPatch } from "./diff.js";

export const REVIEW_SYSTEM_PROMPT = `You are a senior software engineer reviewing a pull request.
Find real problems introduced or exposed by this change: bugs, security issues and performance problems.
Only report style issues when they are likely to cause real confusion or mistakes.

How the code is shown:
- Each file is listed with line numbers from the NEW version of the file.
- "+" after the number marks a line added by this PR.
- "~" marks an unchanged line that is part of the diff.
- Lines starting with "-" (no number) were removed by this PR.
- Lines with no marker are surrounding context, shown so you understand the code.

Rules:
- Only report a finding on a line marked "+" or "~". Prefer "+" lines.
- Use the exact file path and line number shown.
- Do not report something you cannot point to in the code. If unsure, lower the confidence.
- Do not repeat the same issue on several lines; report it once, where it starts.
- It is fine to report nothing. Most good pull requests have zero to three real issues.

Reply with ONLY a JSON object in this exact shape:
{
  "summary": "2-3 sentences: what this change does and your overall assessment",
  "findings": [
    {
      "file": "path/as/shown.ts",
      "line": 42,
      "severity": "bug" | "security" | "performance" | "style",
      "confidence": 0.0 to 1.0,
      "explanation": "What is wrong and what goes wrong at runtime, in 1-3 sentences",
      "suggestedFix": "Replacement code for that line or lines, or an empty string"
    }
  ]
}`;

// Files bigger than this are shown as diff hunks only, not the whole file.
const MAX_FULL_FILE_CHARS = 30_000;

function marker(parsed: ParsedPatch, line: number): string {
  if (parsed.added.has(line)) return "+";
  return isCommentable(parsed, line) ? "~" : " ";
}

function removedLines(parsed: ParsedPatch, beforeLine: number): string[] {
  return (parsed.deletedBefore.get(beforeLine) ?? []).map((text) => `      - | ${text}`);
}

function numbered(line: number, mark: string, text: string): string {
  return `${String(line).padStart(5)} ${mark} | ${text}`;
}

// Renders one file the way the system prompt describes. With the full file we
// show every line, marking the diff; without it (too big or unavailable) we
// show only the hunks.
export function renderFile(path: string, parsed: ParsedPatch, content?: string): string {
  const out = [`### File: ${path}`];
  if (content !== undefined && content.length <= MAX_FULL_FILE_CHARS) {
    const fileLines = content.split("\n");
    if (fileLines.at(-1) === "") fileLines.pop();
    fileLines.forEach((text, i) => {
      const line = i + 1;
      out.push(...removedLines(parsed, line), numbered(line, marker(parsed, line), text));
    });
    out.push(...removedLines(parsed, fileLines.length + 1));
  } else {
    out.push("(Only the changed parts of this file are shown.)");
    // Walk new lines and removal positions together so removals appear in place.
    const keys = [...new Set([...parsed.lines.keys(), ...parsed.deletedBefore.keys()])];
    let previous: number | undefined;
    for (const line of keys.sort((a, b) => a - b)) {
      if (previous !== undefined && line > previous + 1) out.push("  ...");
      out.push(...removedLines(parsed, line));
      const text = parsed.lines.get(line);
      if (text !== undefined) out.push(numbered(line, marker(parsed, line), text));
      previous = line;
    }
  }
  return out.join("\n");
}

export function buildReviewPrompt(title: string, renderedFiles: string[]): string {
  return `Pull request title: ${title}\n\n${renderedFiles.join("\n\n")}`;
}

export function invalidOutputFollowUp(error: string): string {
  return `\n\nYour previous reply could not be used: ${error}\nReply again with ONLY the JSON object described above.`;
}

export const CRITIQUE_SYSTEM_PROMPT = `You are a strict senior engineer double-checking another reviewer's comments
on a pull request before they are posted. Developers lose trust in a review bot that posts
wrong or trivial comments, so be skeptical.

For each finding, look at the code and decide whether it is a real, specific problem worth a
reviewer's time. Drop it (keep: false) if any of these are true:
- The claim is not actually true for the code shown, or depends on code you cannot see.
- It is already handled nearby (a check, a guard, a try/catch, a type that rules it out).
- It is speculative ("might", "could potentially") without a concrete failing case.
- It is a style preference, naming opinion or missing comment.
Keep it only if you can name the input or situation that makes it fail.

Set confidence to how sure you are that the finding is correct and important (0.0 to 1.0).

Reply with ONLY a JSON object in this exact shape, with one verdict per finding id:
{ "verdicts": [ { "id": 1, "keep": true, "confidence": 0.8, "reason": "one short sentence" } ] }`;

// Lines around a finding, numbered and marked like in pass 1.
export function codeSnippet(
  parsed: ParsedPatch,
  content: string | undefined,
  line: number,
  radius = 8,
): string {
  const fileLines = content?.split("\n");
  if (fileLines?.at(-1) === "") fileLines.pop();
  const out: string[] = [];
  for (let n = Math.max(1, line - radius); n <= line + radius; n++) {
    const text = fileLines ? fileLines[n - 1] : parsed.lines.get(n);
    if (text === undefined) continue;
    out.push(...removedLines(parsed, n), numbered(n, n === line ? ">" : marker(parsed, n), text));
  }
  return out.join("\n");
}

export interface CritiqueItem {
  id: number;
  file: string;
  line: number;
  severity: string;
  confidence: number;
  explanation: string;
  suggestedFix: string;
  snippet: string;
}

export function buildCritiquePrompt(title: string, items: CritiqueItem[]): string {
  const blocks = items.map((item) =>
    [
      `## Finding ${item.id}: ${item.file} line ${item.line} [${item.severity}, confidence ${item.confidence}]`,
      `Claim: ${item.explanation}`,
      item.suggestedFix ? `Suggested fix: ${item.suggestedFix}` : "",
      `Code (">" marks the line the finding is on):`,
      item.snippet,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return `Pull request title: ${title}\n\n${blocks.join("\n\n")}`;
}
