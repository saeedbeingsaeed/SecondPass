import { describe, expect, it, vi } from "vitest";
import type { LLMProvider } from "../src/llm/types.js";
import { LLMError } from "../src/llm/types.js";
import { parsePatch } from "../src/review/diff.js";
import { batchFiles, mapFindings, runReview } from "../src/review/pipeline.js";
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
});

describe("batchFiles", () => {
  it("packs files up to the budget and gives oversized files their own batch", () => {
    const f = (path: string, size: number) => ({ path, text: "x".repeat(size) });
    const batches = batchFiles([f("a", 40), f("b", 40), f("c", 200), f("d", 10)], 100);
    expect(batches.map((b) => b.map((x) => x.path))).toEqual([["a", "b"], ["c"], ["d"]]);
  });
});

function fakeLLM(
  replies: (string | Error)[],
): LLMProvider & { complete: ReturnType<typeof vi.fn> } {
  const complete = vi.fn(async () => {
    const next = replies.shift();
    if (next instanceof Error) throw next;
    return { text: next ?? "", inputTokens: 100, outputTokens: 20, latencyMs: 5 };
  });
  return { name: "fake", model: "fake-1", complete };
}

const input = {
  title: "Add two",
  files: [{ path: "src/a.ts", patch: PATCH, content: "one\ntwo\nthree\n" }],
};
const reply = (findings: unknown[]) => JSON.stringify({ summary: "Adds a line.", findings });

describe("runReview", () => {
  it("returns mapped findings and token usage", async () => {
    const llm = fakeLLM([reply([finding(), finding({ line: 99 })])]);
    const out = await runReview(llm, input);
    expect(out.summary).toBe("Adds a line.");
    expect(out.findings).toEqual([finding()]);
    expect(out.stats).toMatchObject({
      llmCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      droppedUnmapped: 1,
    });
  });

  it("retries once on invalid output, telling the model what was wrong", async () => {
    const llm = fakeLLM(["not json", reply([finding()])]);
    const out = await runReview(llm, input);
    expect(out.findings).toHaveLength(1);
    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(llm.complete.mock.calls[1]![0].prompt).toContain("could not be used");
  });

  it("fails gracefully after a second invalid reply", async () => {
    const llm = fakeLLM(["nope", "still nope"]);
    const out = await runReview(llm, input);
    expect(out.findings).toEqual([]);
    expect(out.stats.failedFiles).toEqual(["src/a.ts"]);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });

  it("reports files as failed when the provider is down", async () => {
    const llm = fakeLLM([new LLMError("quota exhausted", 429)]);
    const out = await runReview(llm, input);
    expect(out.stats.failedFiles).toEqual(["src/a.ts"]);
    expect(out.stats.errors[0]).toContain("quota exhausted");
  });

  it("shows the model the file with line numbers and diff markers", async () => {
    const llm = fakeLLM([reply([])]);
    await runReview(llm, input);
    const prompt: string = llm.complete.mock.calls[0]![0].prompt;
    expect(prompt).toContain("    2 + | two");
    expect(prompt).toContain("    1 ~ | one");
  });
});
