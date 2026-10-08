import { formatFindingComment } from "../review/format.js";
import type { ReviewFinding } from "../review/pipeline.js";
import type { Octokit, PullRequestRef } from "./types.js";

const FINGERPRINT_RE = /<!-- secondpass:fp=([0-9a-f]+) -->/;

export function fingerprintMarker(fp: string): string {
  return `<!-- secondpass:fp=${fp} -->`;
}

// Fingerprints of every inline comment SecondPass already posted on this PR,
// on any commit. A finding with a known fingerprint is not posted again.
export async function getPostedFingerprints(
  octokit: Octokit,
  pr: PullRequestRef,
): Promise<Set<string>> {
  const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.number,
    per_page: 100,
  });
  const fingerprints = new Set<string>();
  for (const c of comments) {
    if (c.user?.type !== "Bot") continue;
    const match = FINGERPRINT_RE.exec(c.body);
    if (match?.[1]) fingerprints.add(match[1]);
  }
  return fingerprints;
}

// Posts all findings as one review with inline comments, using `line` + `side`
// (the API's current form) instead of the deprecated diff `position`.
// Returns false if GitHub rejected the comments, so the caller can fall back.
export async function postInlineReview(
  octokit: Octokit,
  pr: PullRequestRef,
  findings: ReviewFinding[],
): Promise<boolean> {
  if (findings.length === 0) return true;
  try {
    await octokit.rest.pulls.createReview({
      owner: pr.owner,
      repo: pr.repo,
      pull_number: pr.number,
      // Pin the review to the commit we reviewed, so line numbers stay correct
      // even if someone pushes while we were working.
      commit_id: pr.headSha,
      event: "COMMENT",
      comments: findings.map((f) => ({
        path: f.file,
        line: f.line,
        side: "RIGHT" as const,
        body: `${formatFindingComment(f)}\n\n${fingerprintMarker(f.fingerprint)}`,
      })),
    });
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 422) return false;
    throw error;
  }
}
