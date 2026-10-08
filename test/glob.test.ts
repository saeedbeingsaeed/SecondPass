import { describe, expect, it } from "vitest";
import { matchesAny } from "../src/review/glob.js";

describe("matchesAny", () => {
  const cases: [string, string, boolean][] = [
    ["*.md", "README.md", true],
    ["*.md", "docs/guide/intro.md", true],
    ["*.md", "src/md.ts", false],
    ["docs/**", "docs/a/b.ts", true],
    ["docs/**", "src/docs/a.ts", false],
    ["docs/", "docs/a.ts", true],
    ["src/*.ts", "src/a.ts", true],
    ["src/*.ts", "src/deep/a.ts", false],
    ["src/**/*.test.ts", "src/a.test.ts", true],
    ["src/**/*.test.ts", "src/x/y/a.test.ts", true],
    ["file?.js", "file1.js", true],
    ["file?.js", "file10.js", false],
    ["a.b+c.js", "a.b+c.js", true],
    ["a.b+c.js", "aXb+c.js", false],
  ];
  it.each(cases)("%s against %s → %s", (pattern, path, expected) => {
    expect(matchesAny(path, [pattern])).toBe(expected);
  });
});
