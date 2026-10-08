import { describe, expect, it } from "vitest";
import { parseEnv, providerSettings } from "../src/config.js";

describe("parseEnv", () => {
  it("treats empty values as not set, so optional settings can be left blank", () => {
    const env = parseEnv({
      GEMINI_API_KEY: "key",
      GEMINI_MODEL: "m",
      GROQ_API_KEY: "",
      DATABASE_URL: "",
      REVIEW_SECOND_PASS: "",
    });
    expect(env.GROQ_API_KEY).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.REVIEW_SECOND_PASS).toBe(true);
  });

  it("parses numbers and booleans from strings", () => {
    const env = parseEnv({ GEMINI_MIN_INTERVAL_MS: "500", REVIEW_SECOND_PASS: "false" });
    expect(env.GEMINI_MIN_INTERVAL_MS).toBe(500);
    expect(env.REVIEW_SECOND_PASS).toBe(false);
  });

  it("explains invalid values", () => {
    expect(() => parseEnv({ LLM_PROVIDER: "openai" })).toThrow(
      /Invalid settings in \.env[\s\S]*LLM_PROVIDER/,
    );
  });
});

describe("providerSettings", () => {
  it("names the missing key for the selected provider", () => {
    expect(() => providerSettings(parseEnv({ GROQ_API_KEY: "" }), "groq")).toThrow("GROQ_API_KEY");
  });
});
