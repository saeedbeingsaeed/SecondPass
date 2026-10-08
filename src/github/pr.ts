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

export async function getHeadSha(
  octokit: Octokit,
  pr: PullRequestRef,
): Promise<string | undefined> {
  const { data } = await octokit.rest.pulls.get({
    owner: pr.owner,
    repo: pr.repo,
    pull_number: pr.number,
  });
  return data.state === "open" ? data.head.sha : undefined;
}

// Paths changed between two commits, or undefined if GitHub can't compare
// them (for example after a force-push removed the old commit).
export async function changedSince(
  octokit: Octokit,
  pr: PullRequestRef,
  baseSha: string,
): Promise<Set<string> | undefined> {
  try {
    const { data } = await octokit.rest.repos.compareCommitsWithBasehead({
      owner: pr.owner,
      repo: pr.repo,
      basehead: `${baseSha}...${pr.headSha}`,
      per_page: 100,
    });
    // The compare API lists at most 300 files; past that, review everything.
    if (!data.files || data.files.length >= 300) return undefined;
    return new Set(data.files.map((f) => f.filename));
  } catch {
    return undefined;
  }
}

// Reads .secondpass.yml from the default branch. Reading it from the PR
// branch would let a PR switch off its own review.
export async function getRepoConfigFile(octokit: Octokit, pr: PullRequestRef): Promise<unknown> {
  const { config } = await octokit.config.get({
    owner: pr.owner,
    repo: pr.repo,
    path: ".secondpass.yml",
  });
  return config;
}
