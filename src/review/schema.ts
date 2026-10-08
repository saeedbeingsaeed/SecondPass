import { z } from "zod";

export const SEVERITIES = ["bug", "security", "performance", "style"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  severity: z.enum(SEVERITIES),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
  // Replacement code for the line(s), or "" when there is no concrete fix.
  suggestedFix: z.string(),
});

export type Finding = z.infer<typeof FindingSchema>;

// Pass 1 reply. The top level must be right; individual findings are checked
// one by one so a single malformed item does not throw away the good ones.
export const ReviewResponseSchema = z.object({
  summary: z.string(),
  findings: z.array(z.unknown()),
});

// Pass 2 reply: one verdict per finding id.
export const VerdictSchema = z.object({
  id: z.number().int(),
  keep: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

export type Verdict = z.infer<typeof VerdictSchema>;

export const CritiqueResponseSchema = z.object({ verdicts: z.array(z.unknown()) });

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

// Models sometimes wrap JSON in ``` fences even when asked not to.
function stripFences(text: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return match?.[1] ?? text.trim();
}

export function parseJson<T>(text: string, schema: z.ZodType<T>): ParseResult<T> {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(text));
  } catch (error) {
    return { ok: false, error: `Not valid JSON: ${(error as Error).message}` };
  }
  const result = schema.safeParse(json);
  if (!result.success) return { ok: false, error: `Wrong shape: ${z.prettifyError(result.error)}` };
  return { ok: true, value: result.data };
}

// Keeps the items that match the schema and counts the rest.
function validItems<T>(items: unknown[], schema: z.ZodType<T>): { items: T[]; invalid: number } {
  const valid: T[] = [];
  for (const item of items) {
    const result = schema.safeParse(item);
    if (result.success) valid.push(result.data);
  }
  return { items: valid, invalid: items.length - valid.length };
}

export interface ParsedReview {
  summary: string;
  findings: Finding[];
  invalidCount: number;
}

export function parseReviewResponse(text: string): ParseResult<ParsedReview> {
  const top = parseJson(text, ReviewResponseSchema);
  if (!top.ok) return top;
  const { items, invalid } = validItems(top.value.findings, FindingSchema);
  return {
    ok: true,
    value: { summary: top.value.summary.trim(), findings: items, invalidCount: invalid },
  };
}

export function parseCritiqueResponse(text: string): ParseResult<Verdict[]> {
  const top = parseJson(text, CritiqueResponseSchema);
  if (!top.ok) return top;
  return { ok: true, value: validItems(top.value.verdicts, VerdictSchema).items };
}
