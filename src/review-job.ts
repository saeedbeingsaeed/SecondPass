import type { Probot } from "probot";
import { getEnv } from "./config.js";
import { getSummaryComment, upsertSummaryComment } from "./github/comments.js";
import {
  changedSince,
  getFileContent,
  getHeadSha,
  getRepoConfigFile,
  listChangedFiles,
} from "./github/pr.js";
import { getPostedFingerprints, postInlineReview } from "./github/review.js";
import type { Octokit, PullRequestRef } from "./github/types.js";
import { getLLM } from "./llm/index.js";
import { selectFiles } from "./review/files.js";
import { formatSummaryComment } from "./review/format.js";
import { runReview, type FileForReview } from "./review/pipeline.js";
import { DEFAULT_CONFIG, parseRepoConfig, type RepoConfig } from "./review/repo-config.js";

type Logger = Probot["log"];

async function loadConfig(octokit: Octokit, pr: PullRequestRef) {
  try {
    return parseRepoConfig(await getRepoConfigFile(octokit, pr));
  } catch (error) {
    // Usually a YAML syntax error.
    return {
      config: DEFAULT_CONFIG as RepoConfig,
      warning: `.secondpass.yml could not be read, so defaults were used: ${(error as Error).message}`,
    };
  }
}

// Reviews one commit of one PR, end to end. Called through a per-PR queue,
// so two reviews of the same PR never run at the same time.
export async function reviewPullRequest(
  octokit: Octokit,
  pr: PullRequestRef,
  title: string,
  log: Logger,
): Promise<void> {
  const started = Date.now();
  const env = getEnv();

  // 1. Skip commits that are no longer the head (a newer push is queued) or
  //    that we already reviewed (webhook redelivery, PR reopened).
  const currentHead = await getHeadSha(octokit, pr);
  if (currentHead !== pr.headSha) {
    log.info("Commit is no longer the PR head (or PR closed), skipping");
    return;
  }
  const summary = await getSummaryComment(octokit, pr);
  if (summary?.reviewedSha === pr.headSha) {
    log.info("Commit already reviewed, skipping");
    return;
  }

  // 2. Decide what to review: only files changed since the last reviewed
  //    commit, minus lockfiles, generated files, binaries and ignored paths.
  const { config, warning } = await loadConfig(octokit, pr);
  let changed = await listChangedFiles(octokit, pr);
  const since = summary?.reviewedSha
    ? await changedSince(octokit, pr, summary.reviewedSha)
    : undefined;
  if (since) changed = changed.filter((f) => since.has(f.filename));

  const { selected, skipped } = selectFiles(
    changed.map((f) => ({ ...f, path: f.filename })),
    config.ignore,
    env.MAX_FILES_PER_REVIEW,
  );
  const files: FileForReview[] = [];
  for (const file of selected) {
    const content = await getFileContent(octokit, pr, file.path);
    files.push({ path: file.path, patch: file.patch!, content });
  }
  log.info(
    { changed: changed.length, reviewing: files.length, incremental: !!since },
    "Selected files",
  );

  // 3. Run the two-pass review.
  const llm = getLLM((attempt, delayMs, error) =>
    log.warn({ attempt, delayMs, error: (error as Error).message }, "LLM call failed, retrying"),
  );
  const output = await runReview(
    llm,
    { title, files },
    {
      secondPass: env.REVIEW_SECOND_PASS,
      confidenceThreshold: config.confidenceThreshold,
      severities: config.severities,
      maxInputTokens: env.MAX_INPUT_TOKENS_PER_REVIEW,
      maxTokensPerCall: env.LLM_MAX_TOKENS_PER_CALL,
    },
  );

  // 4. Post only findings we have not posted before on this PR.
  const postedBefore = await getPostedFingerprints(octokit, pr);
  const fresh = output.findings.filter((f) => !postedBefore.has(f.fingerprint));
  const ok = await postInlineReview(octokit, pr, fresh);
  if (!ok) log.warn("GitHub rejected inline comments; listing them in the summary instead");

  // 5. Update the summary. Record the commit as reviewed only if every file
  //    was reviewed, so failed files are retried on the next event.
  const complete = output.stats.failedFiles.length === 0;
  const body = formatSummaryComment(output, {
    headSha: pr.headSha,
    model: llm.model,
    durationMs: Date.now() - started,
    reviewedFiles: files.length - output.skipped.length,
    posted: fresh,
    alreadyPosted: output.findings.length - fresh.length,
    skipped: [...skipped, ...output.skipped],
    sinceSha: since ? summary?.reviewedSha : undefined,
    configWarning: warning,
    unposted: ok ? undefined : fresh,
  });
  await upsertSummaryComment(octokit, pr, body, summary, complete ? pr.headSha : undefined);

  // Counts only: never log code, prompts or model output.
  log.info(
    {
      posted: fresh.length,
      alreadyPosted: output.findings.length - fresh.length,
      ...output.stats,
      failedFiles: output.stats.failedFiles.length,
      ms: Date.now() - started,
    },
    "Review posted",
  );
}
