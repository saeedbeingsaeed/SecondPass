import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "../src/llm/gemini.js";
import { LLMError } from "../src/llm/types.js";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const provider = new GeminiProvider("test-key", "test-model", 5000);

describe("GeminiProvider", () => {
  it("returns text and token counts", async () => {
    const fetchMock = mockFetch(200, {
      candidates: [{ content: { parts: [{ text: "Hello" }] } }],
      usageMetadata: { promptTokenCount: 10, totalTokenCount: 15 },
    });
    const res = await provider.complete({ system: "s", prompt: "p", json: true });
    expect(res).toMatchObject({ text: "Hello", inputTokens: 10, outputTokens: 5 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("/test-model:generateContent");
    expect(url).not.toContain("test-key");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe("application/json");
  });

  it("turns a 429 into a retryable error with the server's retry delay", async () => {
    mockFetch(429, {
      error: {
        message: "quota",
        details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "27s" }],
      },
    });
    const error = await provider.complete({ system: "s", prompt: "p" }).catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(27_000);
  });

  it("treats a bad request as not retryable", async () => {
    mockFetch(400, { error: { message: "API key not valid" } });
    const error = await provider.complete({ system: "s", prompt: "p" }).catch((e) => e);
    expect(error.retryable).toBe(false);
  });
});
