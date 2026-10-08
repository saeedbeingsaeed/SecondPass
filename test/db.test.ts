import pg from "pg";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, logReview, type ReviewRecord } from "../src/db/log.js";
import type { ReviewStats } from "../src/review/pipeline.js";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides one).
const url = process.env.TEST_DATABASE_URL;

const stats: ReviewStats = {
  llmCalls: 2,
  inputTokens: 1200,
  outputTokens: 300,
  llmLatencyMs: 4000,
  pass1Findings: 3,
  droppedInvalid: 0,
  droppedUnmapped: 0,
  droppedSeverity: 1,
  droppedSecondPass: 1,
  droppedLowConfidence: 0,
  failedFiles: [],
  secondPassFailed: false,
  errors: [],
};

const finding = {
  file: "src/a.ts",
  line: 3,
  severity: "bug" as const,
  confidence: 0.9,
  explanation: "Off by one.",
  suggestedFix: "i < n",
  fingerprint: "abc123",
};

const record = (over: Partial<ReviewRecord> = {}): ReviewRecord => ({
  repo: "o/r",
  prNumber: 7,
  headSha: "deadbeef",
  status: "completed",
  provider: "gemini",
  model: "m",
  secondPass: true,
  filesReviewed: 2,
  filesSkipped: 1,
  totalLatencyMs: 5000,
  stats,
  findings: [
    { finding, posted: true },
    { finding: { ...finding, line: 9, fingerprint: "def456" }, posted: false },
  ],
  ...over,
});

describe.skipIf(!url)("logReview (Postgres)", () => {
  const db = new pg.Pool({ connectionString: url });

  beforeAll(async () => {
    await db.query(readFileSync("src/db/schema.sql", "utf8"));
    await db.query("truncate reviews, findings restart identity");
  });

  afterAll(async () => {
    await db.end();
    await closeDb();
  });

  it("writes the review with token counts, latency and its findings", async () => {
    await logReview(url, record());
    const { rows } = await db.query("select * from reviews");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      repo: "o/r",
      status: "completed",
      input_tokens: 1200,
      output_tokens: 300,
      llm_latency_ms: 4000,
      total_latency_ms: 5000,
      findings_posted: 1,
      dropped_second_pass: 1,
    });
    const findings = await db.query("select line, posted from findings order by line");
    expect(findings.rows).toEqual([
      { line: 3, posted: true },
      { line: 9, posted: false },
    ]);
  });

  it("logs a failed review with no stats", async () => {
    await logReview(
      url,
      record({ status: "error", stats: undefined, findings: undefined, error: "boom" }),
    );
    const { rows } = await db.query(
      "select status, error, llm_calls from reviews where status = 'error'",
    );
    expect(rows).toEqual([{ status: "error", error: "boom", llm_calls: 0 }]);
  });

  it("rolls back the whole review if a finding cannot be written", async () => {
    const before = (await db.query("select count(*)::int as n from reviews")).rows[0].n;
    const bad = record({
      findings: [{ finding: { ...finding, file: null as unknown as string }, posted: true }],
    });
    await expect(logReview(url, bad)).rejects.toThrow();
    const after = (await db.query("select count(*)::int as n from reviews")).rows[0].n;
    expect(after).toBe(before);
  });
});

describe("logReview without a database", () => {
  it("does nothing when DATABASE_URL is not set", async () => {
    await expect(logReview(undefined, record())).resolves.toBeUndefined();
  });
});
