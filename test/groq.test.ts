import { afterEach, describe, expect, it, vi } from "vitest";
import { GroqProvider } from "../src/llm/groq.js";
import { LLMError } from "../src/llm/types.js";

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const provider = new GroqProvider("test-key", "test-model", 5000);

describe("GroqProvider", () => {
  it("sends an OpenAI-style request and returns text and token counts", async () => {
    const fetchMock = mockFetch(200, {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 50, completion_tokens: 7 },
    });
    const res = await provider.complete({ system: "sys", prompt: "user", json: true });
    expect(res).toMatchObject({ text: '{"ok":true}', inputTokens: 50, outputTokens: 7 });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(init.body);
    expect(init.headers.authorization).toBe("Bearer test-key");
    expect(body.model).toBe("test-model");
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("turns a 429 into a retryable error using Retry-After", async () => {
    mockFetch(429, { error: { message: "Rate limit reached" } }, { "retry-after": "7" });
    const error = await provider.complete({ system: "s", prompt: "p" }).catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(7000);
  });

  it("treats an invalid key as not retryable", async () => {
    mockFetch(401, { error: { message: "Invalid API Key" } });
    const error = await provider.complete({ system: "s", prompt: "p" }).catch((e) => e);
    expect(error.retryable).toBe(false);
  });
});
