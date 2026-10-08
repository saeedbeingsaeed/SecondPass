import { describe, expect, it } from "vitest";
import { applyVerdicts, filterByConfidence, filterBySeverity } from "../src/review/filter.js";
import type { Finding } from "../src/review/schema.js";

const f = (line: number, over: Partial<Finding> = {}): Finding => ({
  file: "a.ts",
  line,
  severity: "bug",
  confidence: 0.8,
  explanation: "x",
  suggestedFix: "",
  ...over,
});

describe("applyVerdicts", () => {
  it("keeps only findings the critic kept, with the critic's confidence", () => {
    const kept = applyVerdicts(
      [f(1), f(2), f(3)],
      [
        { id: 1, keep: true, confidence: 0.95, reason: "real" },
        { id: 2, keep: false, confidence: 0.9, reason: "already handled" },
      ],
    );
    // Finding 3 had no verdict, so it is dropped.
    expect(kept).toEqual([f(1, { confidence: 0.95 })]);
  });

  it("ignores verdicts for ids that do not exist", () => {
    expect(applyVerdicts([f(1)], [{ id: 7, keep: true, confidence: 1, reason: "" }])).toEqual([]);
  });
});

describe("filterBySeverity", () => {
  it("drops severities that are not allowed", () => {
    const out = filterBySeverity(
      [f(1), f(2, { severity: "style" })],
      ["bug", "security", "performance"],
    );
    expect(out.map((x) => x.line)).toEqual([1]);
  });
});

describe("filterByConfidence", () => {
  it("keeps findings at or above the threshold", () => {
    const out = filterByConfidence([f(1, { confidence: 0.59 }), f(2, { confidence: 0.6 })], 0.6);
    expect(out.map((x) => x.line)).toEqual([2]);
  });
});
