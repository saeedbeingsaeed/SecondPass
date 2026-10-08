import type { Finding, Severity, Verdict } from "./schema.js";

// Applies pass 2 verdicts. A finding is kept only if the critic explicitly
// said keep; a missing verdict counts as "could not justify it". The critic's
// confidence replaces the original, since it judged with more context.
export function applyVerdicts<T extends Finding>(findings: T[], verdicts: Verdict[]): T[] {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  const kept: T[] = [];
  findings.forEach((finding, index) => {
    const verdict = byId.get(index + 1);
    if (verdict?.keep) kept.push({ ...finding, confidence: verdict.confidence });
  });
  return kept;
}

export function filterBySeverity<T extends Finding>(findings: T[], allowed: Severity[]): T[] {
  return findings.filter((f) => allowed.includes(f.severity));
}

export function filterByConfidence<T extends Finding>(findings: T[], threshold: number): T[] {
  return findings.filter((f) => f.confidence >= threshold);
}
