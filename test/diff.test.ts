import { describe, expect, it } from "vitest";
import { isCommentable, parsePatch } from "../src/review/diff.js";

describe("parsePatch", () => {
  it("numbers added and context lines from the hunk header", () => {
    const patch = ["@@ -10,3 +10,4 @@ function f() {", " a", "-b", "+B", "+C", " d"].join("\n");
    const p = parsePatch(patch);
    expect([...p.context]).toEqual([10, 13]);
    expect([...p.added]).toEqual([11, 12]);
    expect(p.lines.get(12)).toBe("C");
    // "b" was removed just above new line 11.
    expect(p.deletedBefore.get(11)).toEqual(["b"]);
  });

  it("restarts numbering at each hunk", () => {
    const patch = ["@@ -1,2 +1,2 @@", "-x", "+X", " y", "@@ -50,2 +50,3 @@", " p", "+q", " r"].join(
      "\n",
    );
    const p = parsePatch(patch);
    expect([...p.added]).toEqual([1, 51]);
    expect([...p.context]).toEqual([2, 50, 52]);
    expect(isCommentable(p, 30)).toBe(false);
  });

  it("handles a new file (hunk starting at 0,0)", () => {
    const p = parsePatch(["@@ -0,0 +1,3 @@", "+one", "+two", "+three"].join("\n"));
    expect([...p.added]).toEqual([1, 2, 3]);
  });

  it("handles counts omitted from the header (single-line hunks)", () => {
    const p = parsePatch(["@@ -5 +5 @@", "-old", "+new"].join("\n"));
    expect([...p.added]).toEqual([5]);
    expect(p.deletedBefore.get(5)).toEqual(["old"]);
  });

  it("ignores the 'No newline at end of file' marker", () => {
    const patch = [
      "@@ -1,1 +1,1 @@",
      "-a",
      "\\ No newline at end of file",
      "+b",
      "\\ No newline at end of file",
    ].join("\n");
    const p = parsePatch(patch);
    expect([...p.added]).toEqual([1]);
    expect(p.lines.size).toBe(1);
  });

  it("does not count a trailing empty line past the end of the hunk", () => {
    const p = parsePatch("@@ -1,1 +1,2 @@\n a\n+b\n");
    expect([...p.added]).toEqual([2]);
    expect(isCommentable(p, 3)).toBe(false);
  });

  it("treats an empty line inside a hunk as blank context", () => {
    const p = parsePatch(["@@ -1,3 +1,3 @@", " a", "", "-c", "+C"].join("\n"));
    expect(p.context.has(2)).toBe(true);
    expect(p.lines.get(2)).toBe("");
    expect([...p.added]).toEqual([3]);
  });

  it("records a deleted block at the end of a file", () => {
    const p = parsePatch(["@@ -1,3 +1,1 @@", " keep", "-gone1", "-gone2"].join("\n"));
    expect(p.deletedBefore.get(2)).toEqual(["gone1", "gone2"]);
    expect(isCommentable(p, 2)).toBe(false);
  });
});
