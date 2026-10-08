import type { Octokit, PullRequestRef } from "./types.js";

// Hidden marker so we can find and update our own summary comment instead of
// posting a new one on every push.
export const SUMMARY_MARKER = "<!-- secondpass:summary -->";

export async function upsertSummaryComment(
  octokit: Octokit,
  pr: PullRequestRef,
  body: string,
): Promise<void> {
  const fullBody = `${body}\n\n${SUMMARY_MARKER}`;
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: pr.owner,
    repo: pr.repo,
    issue_number: pr.number,
    per_page: 100,
  });
  const existing = comments.find((c) => c.user?.type === "Bot" && c.body?.includes(SUMMARY_MARKER));
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
