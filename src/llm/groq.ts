import { retryAfterHeader } from "./gemini.js";
import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types.js";

// Groq exposes an OpenAI-compatible chat completions API.
const URL = "https://api.groq.com/openai/v1/chat/completions";

interface GroqResponse {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class GroqProvider implements LLMProvider {
  readonly name = "groq";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.prompt },
          ],
          // JSON mode. Groq requires the word "JSON" in the prompt, which ours have.
          ...(request.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new LLMError(`Groq request failed: ${(error as Error).message}`);
    }

    const body = (await res.json().catch(() => ({}))) as GroqResponse;
    if (!res.ok) {
      throw new LLMError(
        `Groq returned ${res.status}: ${body.error?.message ?? res.statusText}`,
        res.status,
        retryAfterHeader(res.headers.get("retry-after")),
      );
    }

    const choice = body.choices?.[0];
    const text = choice?.message?.content ?? "";
    if (!text) {
      throw new LLMError(`Groq returned no text (finish_reason: ${choice?.finish_reason})`, 422);
    }
    return {
      text,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - started,
    };
  }
}
