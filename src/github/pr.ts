import type { Octokit, PullRequestRef } from "./types.js";

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  // Unified diff for this file. GitHub omits it for binaries and very large diffs.
  patch?: string;
}

export async function listChangedFiles(
  octokit: Octokit,
  pr: PullRequestRef,
): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.number,
    per_page: 100,
  });
  return files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch,
  }));
}
