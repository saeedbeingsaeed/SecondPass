import { describe, expect, it } from "vitest";
import { parsePatch } from "../src/review/diff.js";
import { codeSnippet, renderFile } from "../src/review/prompts.js";

describe("renderFile", () => {
  const patch = ["@@ -2,3 +2,3 @@", " b", "-c", "+C", " d"].join("\n");
  const parsed = parsePatch(patch);

  it("shows the whole file, marking diff lines and placing removals in order", () => {
    const text = renderFile("f.ts", parsed, "a\nb\nC\nd\ne\n");
    expect(text.split("\n")).toEqual([
      "### File: f.ts",
      "    1   | a",
      "    2 ~ | b",
      "      - | c",
      "    3 + | C",
      "    4 ~ | d",
      "    5   | e",
    ]);
  });

  it("falls back to hunks only when the content is missing", () => {
    const text = renderFile("f.ts", parsed);
    expect(text).toContain("Only the changed parts");
    expect(text).toContain("    3 + | C");
    expect(text).not.toContain("| a");
  });

  it("shows a gap marker between separate hunks", () => {
    const two = parsePatch(["@@ -1 +1 @@", "-x", "+X", "@@ -10 +10 @@", "-y", "+Y"].join("\n"));
    expect(renderFile("g.ts", two)).toContain("  ...");
  });
});

describe("codeSnippet", () => {
  it("shows lines around the finding, marks it, and stops at the end of the file", () => {
    const parsed = parsePatch(["@@ -1,2 +1,2 @@", " a", "-b", "+B"].join("\n"));
    expect(codeSnippet(parsed, "a\nB\n", 2, 3).split("\n")).toEqual([
      "    1 ~ | a",
      "      - | b",
      "    2 > | B",
    ]);
  });
});
