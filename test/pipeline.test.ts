import { describe, expect, it, vi } from "vitest";
import type { LLMProvider, LLMRequest } from "../src/llm/types.js";
import { LLMError } from "../src/llm/types.js";
import { parsePatch } from "../src/review/diff.js";
import {
  batchFiles,
  fingerprint,
  mapFindings,
  runReview,
  type ReviewOptions,
} from "../src/review/pipeline.js";
import type { Finding } from "../src/review/schema.js";

const finding = (over: Partial<Finding> = {}): Finding => ({
  file: "src/a.ts",
  line: 2,
  severity: "bug",
  confidence: 0.8,
  explanation: "x",
  suggestedFix: "",
  ...over,
});

// Lines 1-3 are in the diff (2 is added); everything else is not.
const PATCH = ["@@ -1,2 +1,3 @@", " one", "+two", " three"].join("\n");

describe("mapFindings", () => {
  const patches = new Map([["src/a.ts", parsePatch(PATCH)]]);

  it("keeps findings on diff lines and drops the rest", () => {
    const { kept, dropped } = mapFindings(
      [
        finding(),
        finding({ line: 3, severity: "performance" }),
        finding({ line: 40 }),
        finding({ file: "src/other.ts" }),
      ],
      patches,
    );
    expect(kept.map((f) => f.line)).toEqual([2, 3]);
    expect(dropped).toBe(2);
  });

  it("normalises ./ and b/ prefixes the model sometimes adds", () => {
    const { kept } = mapFindings(
      [finding({ file: "./src/a.ts" }), finding({ file: "b/src/a.ts", line: 1 })],
      patches,
    );
    expect(kept.map((f) => f.file)).toEqual(["src/a.ts", "src/a.ts"]);
  });

  it("collapses duplicates to the most confident one", () => {
    const { kept } = mapFindings(
      [finding({ confidence: 0.5 }), finding({ confidence: 0.9 })],
      patches,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.confidence).toBe(0.9);
  });

  it("fingerprints by file, severity and the code on the line", () => {
    const { kept } = mapFindings([finding()], patches);
    expect(kept[0]!.fingerprint).toBe(fingerprint("src/a.ts", "bug", "two"));
  });
});

describe("fingerprint", () => {
  it("survives the line moving and whitespace changes", () => {
    expect(fingerprint("a.ts", "bug", "  x =  1;")).toBe(fingerprint("a.ts", "bug", "x = 1;"));
  });

  it("changes when the code or severity changes", () => {
    const base = fingerprint("a.ts", "bug", "x = 1;");
    expect(fingerprint("a.ts", "bug", "x = 2;")).not.toBe(base);
    expect(fingerprint("a.ts", "security", "x = 1;")).not.toBe(base);
  });
});

describe("batchFiles", () => {
  it("packs files up to the token budget and gives oversized files their own batch", () => {
    const f = (path: string, tokens: number) => ({ path, text: "x".repeat(tokens * 4) });
    const batches = batchFiles([f("a", 40), f("b", 40), f("c", 200), f("d", 10)], 100);
    expect(batches.map((b) => b.map((x) => x.path))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
});

type Reply = string | Error;

// Fake LLM: answers pass 1 and pass 2 requests from separate scripted lists.
function fakeLLM(pass1: Reply[], pass2: Reply[] = []) {
  const complete = vi.fn(async (req: LLMRequest) => {
    const queue = req.system.includes("double-checking") ? pass2 : pass1;
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return { text: next ?? "", inputTokens: 100, outputTokens: 20, latencyMs: 5 };
  });
  const llm: LLMProvider = { name: "fake", model: "fake-1", complete };
  return { llm, complete };
}

const input = {
  title: "Add two",
  files: [{ path: "src/a.ts", patch: PATCH, content: "one\ntwo\nthree\n" }],
};
const review = (findings: unknown[]) => JSON.stringify({ summary: "Adds a line.", findings });
const verdicts = (v: unknown[]) => JSON.stringify({ verdicts: v });

const options: ReviewOptions = {
  secondPass: false,
  confidenceThreshold: 0.6,
  severities: ["bug", "security", "performance"],
  maxInputTokens: 10_000,
  maxTokensPerCall: 5_000,
};

describe("runReview, pass 1", () => {
  it("returns mapped findings and token usage", async () => {
    const { llm } = fakeLLM([review([finding(), finding({ line: 99 })])]);
    const out = await runReview(llm, input, options);
    expect(out.summary).toBe("Adds a line.");
    expect(out.findings).toMatchObject([finding()]);
    expect(out.stats).toMatchObject({
      llmCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      pass1Findings: 2,
      droppedUnmapped: 1,
    });
  });

  it("retries once on invalid output, telling the model what was wrong", async () => {
    const { llm, complete } = fakeLLM(["not json", review([finding()])]);
    const out = await runReview(llm, input, options);
    expect(out.findings).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0].prompt).toContain("could not be used");
  });

  it("fails gracefully after a second invalid reply", async () => {
    const { llm, complete } = fakeLLM(["nope", "still nope"]);
    const out = await runReview(llm, input, options);
    expect(out.findings).toEqual([]);
    expect(out.stats.failedFiles).toEqual(["src/a.ts"]);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("reports files as failed when the provider is down", async () => {
    const { llm } = fakeLLM([new LLMError("quota exhausted", 429)]);
    const out = await runReview(llm, input, options);
    expect(out.stats.failedFiles).toEqual(["src/a.ts"]);
    expect(out.stats.errors[0]).toContain("quota exhausted");
  });

  it("shows the model the file with line numbers and diff markers", async () => {
    const { llm, complete } = fakeLLM([review([])]);
    await runReview(llm, input, options);
    const prompt = complete.mock.calls[0]![0].prompt;
    expect(prompt).toContain("    2 + | two");
    expect(prompt).toContain("    1 ~ | one");
  });

  it("drops style findings and low-confidence findings by default", async () => {
    const { llm } = fakeLLM([
      review([finding({ severity: "style" }), finding({ line: 3, confidence: 0.3 })]),
    ]);
    const out = await runReview(llm, input, options);
    expect(out.findings).toEqual([]);
    expect(out.stats).toMatchObject({ droppedSeverity: 1, droppedLowConfidence: 1 });
  });

  it("skips files over the token budget and does not call the model for them", async () => {
    const { llm, complete } = fakeLLM([]);
    const out = await runReview(llm, input, { ...options, maxInputTokens: 5 });
    expect(out.skipped).toEqual([{ path: "src/a.ts", reason: "token limit" }]);
    expect(complete).not.toHaveBeenCalled();
  });
});

describe("runReview, pass 2", () => {
  const withPass2 = { ...options, secondPass: true };

  it("drops findings the critic rejects and uses the critic's confidence", async () => {
    const { llm, complete } = fakeLLM(
      [review([finding(), finding({ line: 3, severity: "performance" })])],
      [
        verdicts([
          { id: 1, keep: true, confidence: 0.9, reason: "real" },
          { id: 2, keep: false, confidence: 0.2, reason: "speculative" },
        ]),
      ],
    );
    const out = await runReview(llm, input, withPass2);
    expect(out.findings.map((f) => [f.line, f.confidence])).toEqual([[2, 0.9]]);
    expect(out.stats.droppedSecondPass).toBe(1);
    // The critic sees the code around the finding, with the line marked.
    expect(complete.mock.calls[1]![0].prompt).toContain("    2 > | two");
  });

  it("applies the threshold to the critic's confidence", async () => {
    const { llm } = fakeLLM(
      [review([finding({ confidence: 0.9 })])],
      [verdicts([{ id: 1, keep: true, confidence: 0.4, reason: "unsure" }])],
    );
    const out = await runReview(llm, input, withPass2);
    expect(out.findings).toEqual([]);
    expect(out.stats.droppedLowConfidence).toBe(1);
  });

  it("falls back to pass 1 findings if the critic is unavailable", async () => {
    const { llm } = fakeLLM([review([finding()])], [new LLMError("down", 503)]);
    const out = await runReview(llm, input, withPass2);
    expect(out.findings).toHaveLength(1);
    expect(out.stats.secondPassFailed).toBe(true);
  });

  it("does not call pass 2 when there is nothing to critique", async () => {
    const { llm, complete } = fakeLLM([review([finding({ severity: "style" })])]);
    await runReview(llm, input, withPass2);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
