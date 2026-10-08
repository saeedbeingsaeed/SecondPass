import { formatFindingComment } from "../review/format.js";
import type { Finding } from "../review/schema.js";
import type { Octokit, PullRequestRef } from "./types.js";

// Posts all findings as one review with inline comments. Using `line` + `side`
// (the API's current form) instead of the deprecated diff `position`.
// Returns false if GitHub rejected the comments, so the caller can fall back.
export async function postInlineReview(
  octokit: Octokit,
  pr: PullRequestRef,
  findings: Finding[],
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
        body: formatFindingComment(f),
      })),
    });
    return true;
  } catch (error) {
    if ((error as { status?: number }).status === 422) return false;
    throw error;
  }
}
