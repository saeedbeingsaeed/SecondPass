import { describe, expect, it } from "vitest";
import {
  formatFindingComment,
  formatSummaryComment,
  type SummaryMeta,
} from "../src/review/format.js";
import type { ReviewFinding, ReviewOutput, ReviewStats } from "../src/review/pipeline.js";

const finding: ReviewFinding = {
  file: "src/a.ts",
  line: 2,
  severity: "security",
  confidence: 0.91,
  explanation: "User input reaches the SQL query unescaped.",
  suggestedFix: "db.query('select * from t where id = $1', [id])",
  fingerprint: "abc",
};

const stats: ReviewStats = {
  llmCalls: 2,
  inputTokens: 1000,
  outputTokens: 500,
  llmLatencyMs: 1,
  pass1Findings: 3,
  droppedInvalid: 0,
  droppedUnmapped: 0,
  droppedSeverity: 0,
  droppedSecondPass: 1,
  droppedLowConfidence: 0,
  failedFiles: [],
  secondPassFailed: false,
  errors: [],
};
const output = (over: Partial<ReviewOutput> = {}): ReviewOutput => ({
  summary: "Adds a query.",
  findings: [],
  skipped: [],
  stats,
  ...over,
});
const meta = (over: Partial<SummaryMeta> = {}): SummaryMeta => ({
  headSha: "abcdef123",
  model: "m",
  durationMs: 4200,
  reviewedFiles: 2,
  posted: [],
  alreadyPosted: 0,
  skipped: [],
  ...over,
});

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
  it("counts new comments by severity and mentions earlier ones", () => {
    const body = formatSummaryComment(
      output({ findings: [finding, finding] }),
      meta({ posted: [finding, { ...finding, severity: "bug" }], alreadyPosted: 1 }),
    );
    expect(body).toContain(
      "**2 new comments** · 🐛 Bug ×1 · 🔒 Security ×1 · 1 already posted earlier",
    );
    expect(body).toContain("1,500 tokens");
    expect(body).toContain("1 finding filtered out");
  });

  it("says when the only issues are ones already commented on", () => {
    const body = formatSummaryComment(output(), meta({ alreadyPosted: 2 }));
    expect(body).toContain("No new issues. 2 issues commented on earlier are still present.");
  });

  it("says no issues were found", () => {
    expect(formatSummaryComment(output(), meta())).toContain("✅ No issues found.");
  });

  it("warns when the PR was too large and lists skipped files by reason", () => {
    const body = formatSummaryComment(
      output(),
      meta({
        skipped: [
          { path: "yarn.lock", reason: "lockfile" },
          { path: "big.ts", reason: "token limit" },
        ],
      }),
    );
    expect(body).toContain("This PR is large: 1 file was not reviewed");
    expect(body).toContain("Skipped 2 files");
    expect(body).toContain("- **lockfile**: `yarn.lock`");
  });

  it("does not warn about size when only lockfiles were skipped", () => {
    const body = formatSummaryComment(
      output(),
      meta({ skipped: [{ path: "yarn.lock", reason: "lockfile" }] }),
    );
    expect(body).not.toContain("This PR is large");
  });

  it("says when files could not be reviewed", () => {
    const body = formatSummaryComment(
      output({ stats: { ...stats, failedFiles: ["x.ts"] } }),
      meta(),
    );
    expect(body).toContain("could not be reviewed");
  });

  it("mentions incremental reviews and config problems", () => {
    const body = formatSummaryComment(
      output(),
      meta({ sinceSha: "1234567890", configWarning: "bad yaml" }),
    );
    expect(body).toContain("Reviewed changes since 1234567.");
    expect(body).toContain("bad yaml");
  });

  it("lists findings in the summary when inline posting failed", () => {
    const body = formatSummaryComment(output(), meta({ posted: [finding], unposted: [finding] }));
    expect(body).toContain("`src/a.ts:2`");
  });
});
