import type { Octokit, PullRequestRef } from "./types.js";

// Hidden marker on our summary comment. It also records the last commit that
// was fully reviewed, so we can skip repeats and review only what changed.
// Storing this on GitHub (not in memory or the database) means it survives
// restarts and the free host going to sleep.
const SUMMARY_PREFIX = "<!-- secondpass:summary";
const SUMMARY_RE = /<!-- secondpass:summary(?: sha=([0-9a-f]{7,40}))? -->/;

export function summaryMarker(reviewedSha?: string): string {
  return reviewedSha ? `${SUMMARY_PREFIX} sha=${reviewedSha} -->` : `${SUMMARY_PREFIX} -->`;
}

export interface SummaryComment {
  id: number;
  reviewedSha?: string;
}

interface IssueComment {
  id: number;
  body?: string;
  user: { type: string } | null;
}

export function findSummary(comments: IssueComment[]): SummaryComment | undefined {
  for (const c of comments) {
    if (c.user?.type !== "Bot") continue;
    const match = c.body ? SUMMARY_RE.exec(c.body) : null;
    if (match) return { id: c.id, reviewedSha: match[1] };
  }
  return undefined;
}

export async function getSummaryComment(
  octokit: Octokit,
  pr: PullRequestRef,
): Promise<SummaryComment | undefined> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  return findSummary(comments);
}

export async function upsertSummaryComment(
  octokit: Octokit,
  pr: PullRequestRef,
  body: string,
  existing: SummaryComment | undefined,
  reviewedSha?: string,
): Promise<void> {
  const fullBody = `${body}\n\n${summaryMarker(reviewedSha)}`;
  if (existing) {
    await octokit.rest.issues.updateComment({
      owner: pr.owner,
      repo: pr.repo,
      comment_id: existing.id,
      body: fullBody,
    });
  } else {
    await octokit.rest.issues.createComment({
      owner: pr.owner,
      repo: pr.repo,
      issue_number: pr.number,
      body: fullBody,
    });
  }
}
