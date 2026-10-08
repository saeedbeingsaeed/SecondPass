import { describe, expect, it } from "vitest";
import { estimateTokens, selectFiles, skipReason } from "../src/review/files.js";

const file = (path: string, over: { status?: string; patch?: string } = {}) => ({
  path,
  status: over.status ?? "modified",
  patch: "patch" in over ? over.patch : "@@ -1 +1 @@\n-a\n+b",
});

describe("skipReason", () => {
  it.each([
    ["package-lock.json", "lockfile"],
    ["apps/web/yarn.lock", "lockfile"],
    ["go.sum", "lockfile"],
    ["dist/index.js", "generated"],
    ["public/app.min.js", "generated"],
    ["src/__snapshots__/a.test.ts.snap", "generated"],
    ["api/v1/service.pb.go", "generated"],
    ["logo.png", "binary"],
  ])("%s → %s", (path, reason) => {
    expect(skipReason(file(path), [])).toBe(reason);
  });

  it("skips files GitHub sent no patch for", () => {
    expect(skipReason(file("big.sql", { patch: undefined }), [])).toBe("binary");
  });

  it("skips deleted files and config-ignored paths", () => {
    expect(skipReason(file("a.ts", { status: "removed" }), [])).toBe("deleted");
    expect(skipReason(file("docs/x.ts"), ["docs/**"])).toBe("ignored by config");
  });

  it("keeps ordinary source files", () => {
    expect(skipReason(file("src/build.ts"), [])).toBeUndefined();
  });
});

describe("selectFiles", () => {
  it("applies the file limit after skipping and reports everything left out", () => {
    const { selected, skipped } = selectFiles(
      [file("yarn.lock"), file("a.ts"), file("b.ts"), file("c.ts")],
      [],
      2,
    );
    expect(selected.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(skipped).toEqual([
      { path: "yarn.lock", reason: "lockfile" },
      { path: "c.ts", reason: "file limit" },
    ]);
  });
});

describe("estimateTokens", () => {
  it("is about four characters per token", () => {
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });
});
