import { describe, expect, it } from "vitest";
import { formatFindingComment, formatSummaryComment } from "../src/review/format.js";
import type { ReviewOutput } from "../src/review/pipeline.js";

const finding = {
  file: "src/a.ts",
  line: 2,
  severity: "security" as const,
  confidence: 0.91,
  explanation: "User input reaches the SQL query unescaped.",
  suggestedFix: "db.query('select * from t where id = $1', [id])",
};

const stats = {
  llmCalls: 1,
  inputTokens: 1000,
  outputTokens: 500,
  llmLatencyMs: 1,
  droppedInvalid: 0,
  droppedUnmapped: 0,
  failedFiles: [],
  errors: [],
};
const meta = { headSha: "abcdef123", model: "m", fileCount: 2, durationMs: 4200 };

describe("formatFindingComment", () => {
  it("shows severity, confidence, explanation and the fix", () => {
    const body = formatFindingComment(finding);
    expect(body).toContain("🔒 Security");
    expect(body).toContain("confidence 0.91");
    expect(body).toContain("```ts\ndb.query");
  });

  it("uses a longer fence when the fix itself contains backticks", () => {
    const body = formatFindingComment({ ...finding, suggestedFix: "const s = ```x```;" });
    expect(body).toContain("````ts");
  });

  it("omits the fix section when there is no fix", () => {
    expect(formatFindingComment({ ...finding, suggestedFix: " " })).not.toContain("Suggested fix");
  });
});

describe("formatSummaryComment", () => {
  it("counts findings by severity", () => {
    const output: ReviewOutput = {
      summary: "Adds a query.",
      findings: [finding, { ...finding, severity: "bug" }],
      stats,
    };
    const body = formatSummaryComment(output, meta);
    expect(body).toContain("**2 comments**");
    expect(body).toContain("🐛 Bug ×1 · 🔒 Security ×1");
    expect(body).toContain("1,500 tokens");
  });

  it("says when files could not be reviewed", () => {
    const output: ReviewOutput = {
      summary: "",
      findings: [],
      stats: { ...stats, failedFiles: ["x.ts"] },
    };
    expect(formatSummaryComment(output, meta)).toContain("could not be reviewed");
  });

  it("lists findings in the summary when inline posting failed", () => {
    const output: ReviewOutput = { summary: "", findings: [finding], stats };
    expect(formatSummaryComment(output, { ...meta, unposted: [finding] })).toContain(
      "`src/a.ts:2`",
    );
  });
});
