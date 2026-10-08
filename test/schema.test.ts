import { describe, expect, it } from "vitest";
import { parseReviewResponse } from "../src/review/schema.js";

const good = {
  file: "a.ts",
  line: 3,
  severity: "bug",
  confidence: 0.9,
  explanation: "Off by one.",
  suggestedFix: "i < n",
};

describe("parseReviewResponse", () => {
  it("accepts valid output", () => {
    const res = parseReviewResponse(JSON.stringify({ summary: "ok", findings: [good] }));
    expect(res).toEqual({ ok: true, summary: "ok", findings: [good], invalidCount: 0 });
  });

  it("strips markdown code fences", () => {
    const res = parseReviewResponse(
      "```json\n" + JSON.stringify({ summary: "", findings: [] }) + "\n```",
    );
    expect(res.ok).toBe(true);
  });

  it("rejects text that is not JSON", () => {
    const res = parseReviewResponse("Sure! Here are the findings:");
    expect(res).toMatchObject({ ok: false });
  });

  it("rejects the wrong top-level shape", () => {
    expect(parseReviewResponse(JSON.stringify([good])).ok).toBe(false);
    expect(parseReviewResponse(JSON.stringify({ summary: "x" })).ok).toBe(false);
  });

  it("drops individual bad findings but keeps the good ones", () => {
    const bad = [
      { ...good, severity: "nitpick" },
      { ...good, confidence: 1.5 },
      { ...good, line: 0 },
      { ...good, line: "3" },
      { ...good, explanation: "" },
      { file: "a.ts" },
    ];
    const res = parseReviewResponse(JSON.stringify({ summary: "", findings: [good, ...bad] }));
    expect(res).toMatchObject({ ok: true, findings: [good], invalidCount: bad.length });
  });
});
