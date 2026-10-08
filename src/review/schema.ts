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

// The top level must be right; individual findings are checked one by one so
// a single malformed item does not throw away the good ones.
export const ReviewResponseSchema = z.object({
  summary: z.string(),
  findings: z.array(z.unknown()),
});

export type ParseResult =
  | { ok: true; summary: string; findings: Finding[]; invalidCount: number }
  | { ok: false; error: string };

// Models sometimes wrap JSON in ``` fences even when asked not to.
function stripFences(text: string): string {
  const match = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text);
  return match?.[1] ?? text.trim();
}

export function parseReviewResponse(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(text));
  } catch (error) {
    return { ok: false, error: `Not valid JSON: ${(error as Error).message}` };
  }
  const top = ReviewResponseSchema.safeParse(json);
  if (!top.success) {
    return { ok: false, error: `Wrong shape: ${z.prettifyError(top.error)}` };
  }
  const findings: Finding[] = [];
  let invalidCount = 0;
  for (const item of top.data.findings) {
    const result = FindingSchema.safeParse(item);
    if (result.success) findings.push(result.data);
    else invalidCount++;
  }
  return { ok: true, summary: top.data.summary.trim(), findings, invalidCount };
}
