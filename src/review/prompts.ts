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
