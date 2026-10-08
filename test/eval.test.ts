import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { catchesBug, EvalCasesSchema, formatSummaryTable, summarize } from "../eval/metrics.js";
import type { Finding } from "../src/review/schema.js";

const f = (file: string, line: number): Finding => ({
  file,
  line,
  severity: "bug",
  confidence: 0.9,
  explanation: "x",
  suggestedFix: "",
});
const bug = { file: "src/a.js", startLine: 10, endLine: 12 };

describe("catchesBug", () => {
  it("counts a finding inside the range in the right file", () => {
    expect(catchesBug([f("src/a.js", 11)], bug)).toBe(true);
    expect(catchesBug([f("src/a.js", 10)], bug)).toBe(true);
    expect(catchesBug([f("src/a.js", 12)], bug)).toBe(true);
  });

  it("does not count other lines or other files", () => {
    expect(catchesBug([f("src/a.js", 13), f("src/b.js", 11)], bug)).toBe(false);
  });

  it("widens the range by the tolerance", () => {
    expect(catchesBug([f("src/a.js", 14)], bug, 2)).toBe(true);
    expect(catchesBug([f("src/a.js", 15)], bug, 2)).toBe(false);
  });
});

describe("summarize", () => {
  it("computes recall and per-PR averages", () => {
    const base = {
      comments: 2,
      pass1Findings: 4,
      tokens: 1000,
      llmCalls: 2,
      latencyMs: 3000,
      failed: false,
    };
    const s = summarize({ provider: "gemini", model: "m", secondPass: true }, [
      { caseId: "a", caught: true, ...base },
      { caseId: "b", caught: false, ...base, comments: 4, tokens: 3000 },
    ]);
    expect(s).toMatchObject({ recall: 0.5, commentsPerPr: 3, tokensPerPr: 2000, failedCases: 0 });
    expect(formatSummaryTable([s])).toContain("| gemini | `m` | on | 50% (1/2) | 3.0 | 2,000 |");
  });
});

describe("eval/cases.json", () => {
  it("is valid", () => {
    const cases = EvalCasesSchema.parse(JSON.parse(readFileSync("eval/cases.json", "utf8")));
    expect(cases.length).toBeGreaterThanOrEqual(3);
  });

  it("rejects a malformed case", () => {
    const bad = [{ repo: "no-slash", pr: 1, bug: { file: "a", startLine: 5, endLine: 2 } }];
    expect(EvalCasesSchema.safeParse(bad).success).toBe(false);
  });
});
