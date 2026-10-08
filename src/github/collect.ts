import { selectFiles, type SkippedFile } from "../review/files.js";
import type { FileForReview } from "../review/pipeline.js";
import { DEFAULT_CONFIG, parseRepoConfig, type RepoConfig } from "../review/repo-config.js";
import { getFileContent, getRepoConfigFile, listChangedFiles } from "./pr.js";
import type { Octokit, PullRequestRef } from "./types.js";

export interface CollectedFiles {
  files: FileForReview[];
  skipped: SkippedFile[];
  changedCount: number;
}

// Fetches the PR's changed files, drops the ones we never review, applies the
// file limit, and downloads full contents for the rest. Shared by the bot and
// the eval script so both review exactly the same input.
export async function collectFiles(
  octokit: Octokit,
  pr: PullRequestRef,
  config: RepoConfig,
  maxFiles: number,
  // When set, only these paths are considered (incremental review).
  onlyPaths?: Set<string>,
): Promise<CollectedFiles> {
  let changed = await listChangedFiles(octokit, pr);
  if (onlyPaths) changed = changed.filter((f) => onlyPaths.has(f.filename));
  const { selected, skipped } = selectFiles(
    changed.map((f) => ({ ...f, path: f.filename })),
    config.ignore,
    maxFiles,
  );
  const files: FileForReview[] = [];
  for (const file of selected) {
    const content = await getFileContent(octokit, pr, file.path);
    files.push({ path: file.path, patch: file.patch!, content });
  }
  return { files, skipped, changedCount: changed.length };
}

export async function loadRepoConfig(
  octokit: Octokit,
  pr: PullRequestRef,
): Promise<{ config: RepoConfig; warning?: string }> {
  try {
    return parseRepoConfig(await getRepoConfigFile(octokit, pr));
  } catch (error) {
    // Usually a YAML syntax error.
    return {
      config: DEFAULT_CONFIG,
      warning: `.secondpass.yml could not be read, so defaults were used: ${(error as Error).message}`,
    };
  }
}
