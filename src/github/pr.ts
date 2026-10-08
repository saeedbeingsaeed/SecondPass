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

// Full contents of a file at the PR's head commit. Head commits of fork PRs
// are reachable from the base repo, so this works for forks too.
// Returns undefined if the file cannot be read; the review then falls back to the diff.
export async function getFileContent(
  octokit: Octokit,
  pr: PullRequestRef,
  path: string,
): Promise<string | undefined> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner: pr.owner,
      repo: pr.repo,
      path,
      ref: pr.headSha,
      mediaType: { format: "raw" },
    });
    return typeof res.data === "string" ? res.data : undefined;
  } catch {
    return undefined;
  }
}
