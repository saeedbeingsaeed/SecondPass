import { LLMError, type LLMProvider, type LLMRequest, type LLMResponse } from "./types.js";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; details?: { "@type"?: string; retryDelay?: string }[] };
}

// Gemini reports how long to wait in the body as e.g. "retryDelay": "27s".
function retryDelayFromBody(body: GeminiResponse): number | undefined {
  const info = body.error?.details?.find((d) => d["@type"]?.endsWith("RetryInfo"));
  const seconds = info?.retryDelay ? Number.parseFloat(info.retryDelay) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export function retryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs: number,
  ) {}

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/${encodeURIComponent(this.model)}:generateContent`, {
        method: "POST",
        // Key goes in a header, not the URL, so it never shows up in request logs.
        headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            temperature: 0.2,
            ...(request.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new LLMError(`Gemini request failed: ${(error as Error).message}`);
    }

    const body = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      const retryAfter =
        retryAfterHeader(res.headers.get("retry-after")) ?? retryDelayFromBody(body);
      throw new LLMError(
        `Gemini returned ${res.status}: ${body.error?.message ?? res.statusText}`,
        res.status,
        retryAfter,
      );
    }

    const candidate = body.candidates?.[0];
    const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!text) {
      // Usually a safety block or MAX_TOKENS with no output. Not worth retrying.
      throw new LLMError(`Gemini returned no text (finishReason: ${candidate?.finishReason})`, 422);
    }
    const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
    const total = body.usageMetadata?.totalTokenCount ?? inputTokens;
    return {
      text,
      inputTokens,
      // Total minus prompt also counts "thinking" tokens, which are billed as output.
      outputTokens: total - inputTokens,
      latencyMs: Date.now() - started,
    };
  }
}
