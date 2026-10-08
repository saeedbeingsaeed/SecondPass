import { describe, expect, it } from "vitest";
import { buildDiffText, formatSummaryComment } from "../src/review/summary.js";

const file = (name: string, patch: string) => ({
  filename: name,
  status: "modified",
  additions: 1,
  deletions: 0,
  patch,
});

describe("buildDiffText", () => {
  it("stops adding files once the budget is reached", () => {
    const files = [file("a.ts", "x".repeat(50)), file("b.ts", "y".repeat(50))];
    const { text, truncated } = buildDiffText(files, 80);
    expect(text).toContain("a.ts");
    expect(text).not.toContain("b.ts");
    expect(truncated).toBe(true);
  });
});

describe("formatSummaryComment", () => {
  it("includes the short sha, model and token count", () => {
    const body = formatSummaryComment(
      {
        summary: "Adds login.",
        truncated: false,
        inputTokens: 1000,
        outputTokens: 234,
        latencyMs: 2500,
      },
      { headSha: "abcdef1234567", model: "gemini-x", fileCount: 3 },
    );
    expect(body).toContain("Adds login.");
    expect(body).toContain("abcdef1");
    expect(body).toContain("1,234 tokens");
    expect(body).not.toContain("only part of the diff");
  });
});
