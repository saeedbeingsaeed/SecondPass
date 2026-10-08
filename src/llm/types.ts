export interface LLMRequest {
  system: string;
  prompt: string;
  // Ask the model for a JSON object instead of free text.
  json?: boolean;
}

export interface LLMResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    // Set when the provider told us how long to wait (Retry-After or similar).
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "LLMError";
  }

  get retryable(): boolean {
    // No status means the request never got a response (network error, timeout).
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}
