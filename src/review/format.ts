import type { SkippedFile } from "./files.js";
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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
  durationMs: number;
  // Number of files sent to the model.
  reviewedFiles: number;
  // Findings posted as new inline comments in this run.
  posted: Finding[];
  // Findings already posted on an earlier commit.
  alreadyPosted: number;
  // Files skipped before or during the review, with why.
  skipped: SkippedFile[];
  // Set when only files changed since this commit were reviewed.
  sinceSha?: string;
  configWarning?: string;
  // Findings we could not post inline (GitHub rejected the review).
  unposted?: Finding[];
}

function skippedSection(skipped: SkippedFile[]): string[] {
  if (skipped.length === 0) return [];
  const lines: string[] = [];
  const limited = skipped.filter((s) => s.reason === "file limit" || s.reason === "token limit");
  if (limited.length) {
    lines.push(
      "",
      `> ⚠️ This PR is large: ${plural(limited.length, "file")} ${limited.length === 1 ? "was" : "were"} ` +
        "not reviewed because of the file or token limit. Split the PR to get a full review.",
    );
  }
  const byReason = new Map<string, string[]>();
  for (const s of skipped) byReason.set(s.reason, [...(byReason.get(s.reason) ?? []), s.path]);
  lines.push("", `<details><summary>Skipped ${plural(skipped.length, "file")}</summary>`, "");
  for (const [reason, paths] of byReason) {
    const shown = paths.slice(0, 20).map((p) => `\`${p}\``);
    if (paths.length > 20) shown.push(`and ${paths.length - 20} more`);
    lines.push(`- **${reason}**: ${shown.join(", ")}`);
  }
  lines.push("", "</details>");
  return lines;
}

export function formatSummaryComment(output: ReviewOutput, meta: SummaryMeta): string {
  const { stats } = output;
  const lines = ["## SecondPass review", ""];
  if (meta.sinceSha) {
    lines.push(`Reviewed changes since ${meta.sinceSha.slice(0, 7)}.`, "");
  }
  if (output.summary) lines.push(output.summary, "");

  const total = meta.posted.length + meta.alreadyPosted;
  if (meta.posted.length === 0 && meta.alreadyPosted > 0) {
    lines.push(
      `No new issues. ${plural(meta.alreadyPosted, "issue")} commented on earlier ${meta.alreadyPosted === 1 ? "is" : "are"} still present.`,
    );
  } else if (total === 0) {
    lines.push(
      meta.reviewedFiles === 0
        ? "Nothing to review in this update."
        : stats.failedFiles.length
          ? "No issues found in the files reviewed."
          : "✅ No issues found.",
    );
  } else {
    const counts = (Object.keys(SEVERITY_LABEL) as Severity[])
      .map((s) => [s, meta.posted.filter((f) => f.severity === s).length] as const)
      .filter(([, count]) => count > 0)
      .map(([s, count]) => `${SEVERITY_LABEL[s]} ×${count}`);
    const parts = [`**${plural(meta.posted.length, "new comment")}**`, ...counts];
    if (meta.alreadyPosted) parts.push(`${meta.alreadyPosted} already posted earlier`);
    lines.push(parts.join(" · "));
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
      `> ⚠️ ${plural(stats.failedFiles.length, "file")} could not be reviewed because the model was ` +
        "unavailable or returned invalid output. Push again to retry: " +
        stats.failedFiles.map((f) => `\`${f}\``).join(", "),
    );
  }
  if (stats.secondPassFailed) {
    lines.push(
      "",
      "> Note: the second review pass was unavailable, so findings were not double-checked.",
    );
  }
  if (meta.configWarning) lines.push("", `> ⚠️ ${meta.configWarning}`);
  lines.push(...skippedSection(meta.skipped));

  const filtered = stats.droppedSecondPass + stats.droppedLowConfidence + stats.droppedSeverity;
  const tokens = (stats.inputTokens + stats.outputTokens).toLocaleString("en-US");
  lines.push(
    "",
    `<sub>Commit ${meta.headSha.slice(0, 7)} · ${plural(meta.reviewedFiles, "file")} · ${meta.model} · ` +
      `${plural(stats.llmCalls, "LLM call")} · ${tokens} tokens · ${plural(filtered, "finding")} filtered out · ` +
      `${(meta.durationMs / 1000).toFixed(1)}s</sub>`,
  );
  return lines.join("\n");
}
