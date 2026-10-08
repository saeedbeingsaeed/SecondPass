import { describe, expect, it } from "vitest";
import { parseCritiqueResponse, parseReviewResponse } from "../src/review/schema.js";

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
    expect(res).toEqual({ ok: true, value: { summary: "ok", findings: [good], invalidCount: 0 } });
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
    expect(res).toMatchObject({ ok: true, value: { findings: [good], invalidCount: bad.length } });
  });
});

describe("parseCritiqueResponse", () => {
  it("returns valid verdicts and drops malformed ones", () => {
    const res = parseCritiqueResponse(
      JSON.stringify({
        verdicts: [
          { id: 1, keep: true, confidence: 0.8, reason: "real" },
          { id: 2, keep: "yes", confidence: 0.8, reason: "bad type" },
        ],
      }),
    );
    expect(res).toEqual({
      ok: true,
      value: [{ id: 1, keep: true, confidence: 0.8, reason: "real" }],
    });
  });

  it("rejects a reply without a verdicts array", () => {
    expect(parseCritiqueResponse(JSON.stringify({ findings: [] })).ok).toBe(false);
  });
});
