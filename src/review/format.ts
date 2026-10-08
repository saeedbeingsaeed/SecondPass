import type { ReviewOutput } from "./pipeline.js";
import type { Finding, Severity } from "./schema.js";

export const SEVERITY_LABEL: Record<Severity, string> = {
  bug: "🐛 Bug",
  security: "🔒 Security",
  performance: "⚡ Performance",
  style: "🎨 Style",
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  py: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  php: "php",
  cs: "csharp",
  c: "c",
  h: "c",
  cpp: "cpp",
  swift: "swift",
  sh: "bash",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
};

function languageFor(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[extension] ?? "";
}

// The fix is shown as a plain code block, not a GitHub ```suggestion block:
// a suggestion replaces exactly the commented line, and model fixes often
// span several lines, so one click could silently break the code.
export function formatFindingComment(finding: Finding): string {
  const lines = [
    `**${SEVERITY_LABEL[finding.severity]}** · confidence ${finding.confidence.toFixed(2)}`,
    "",
    finding.explanation.trim(),
  ];
  const fix = finding.suggestedFix.trim();
  if (fix) {
    // Pick a fence longer than any backtick run inside the fix.
    const longestRun = Math.max(2, ...(fix.match(/`+/g) ?? []).map((run) => run.length));
    const fence = "`".repeat(longestRun + 1);
    lines.push("", "<details><summary>Suggested fix</summary>", "");
    lines.push(`${fence}${languageFor(finding.file)}`, fix, fence, "", "</details>");
  }
  return lines.join("\n");
}

export interface SummaryMeta {
  headSha: string;
  model: string;
  fileCount: number;
  durationMs: number;
  // Findings we could not post inline (GitHub rejected the review).
  unposted?: Finding[];
}

export function formatSummaryComment(output: ReviewOutput, meta: SummaryMeta): string {
  const { findings, stats } = output;
  const lines = ["## SecondPass review", ""];
  if (output.summary) lines.push(output.summary, "");

  if (findings.length === 0) {
    lines.push(
      stats.failedFiles.length ? "No issues found in the files reviewed." : "✅ No issues found.",
    );
  } else {
    const counts = (Object.keys(SEVERITY_LABEL) as Severity[])
      .map(
        (severity) => [severity, findings.filter((f) => f.severity === severity).length] as const,
      )
      .filter(([, count]) => count > 0)
      .map(([severity, count]) => `${SEVERITY_LABEL[severity]} ×${count}`);
    const noun = findings.length === 1 ? "comment" : "comments";
    lines.push(`**${findings.length} ${noun}** · ${counts.join(" · ")}`);
  }

  if (meta.unposted?.length) {
    lines.push("", "GitHub rejected the inline comments, so here they are:", "");
    for (const f of meta.unposted) {
      lines.push(
        `- \`${f.file}:${f.line}\` ${SEVERITY_LABEL[f.severity]}: ${f.explanation.trim()}`,
      );
    }
  }
  if (stats.failedFiles.length) {
    lines.push(
      "",
      `> ⚠️ ${stats.failedFiles.length} file(s) could not be reviewed because the model was unavailable or returned invalid output: ` +
        stats.failedFiles.map((f) => `\`${f}\``).join(", "),
    );
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const tokens = (stats.inputTokens + stats.outputTokens).toLocaleString("en-US");
  lines.push(
    "",
    `<sub>Commit ${meta.headSha.slice(0, 7)} · ${plural(meta.fileCount, "file")} · ${meta.model} · ` +
      `${plural(stats.llmCalls, "LLM call")} · ${tokens} tokens · ${(meta.durationMs / 1000).toFixed(1)}s</sub>`,
  );
  return lines.join("\n");
}
