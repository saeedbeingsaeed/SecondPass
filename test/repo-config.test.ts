import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, parseRepoConfig } from "../src/review/repo-config.js";

describe("parseRepoConfig", () => {
  it("uses defaults when there is no config file", () => {
    expect(parseRepoConfig({})).toEqual({ config: DEFAULT_CONFIG });
    expect(DEFAULT_CONFIG.severities).not.toContain("style");
  });

  it("reads all three settings", () => {
    const { config } = parseRepoConfig({
      ignore: ["docs/**"],
      confidenceThreshold: 0.8,
      severities: ["security"],
    });
    expect(config).toEqual({
      ignore: ["docs/**"],
      confidenceThreshold: 0.8,
      severities: ["security"],
    });
  });

  it("falls back to defaults with a warning on invalid values", () => {
    const result = parseRepoConfig({ confidenceThreshold: 7, severities: ["typos"] });
    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.warning).toContain("invalid");
  });
});
