import type { Probot } from "probot";
import { getEnv } from "./config.js";
import { logReview, type ReviewRecord } from "./db/log.js";
import { collectFiles, loadRepoConfig } from "./github/collect.js";
import { getSummaryComment, upsertSummaryComment } from "./github/comments.js";
import { changedSince, getHeadSha } from "./github/pr.js";
import { getPostedFingerprints, postInlineReview } from "./github/review.js";
import type { Octokit, PullRequestRef } from "./github/types.js";
import { getLLM } from "./llm/index.js";
import { formatSummaryComment } from "./review/format.js";
import { runReview } from "./review/pipeline.js";

type Logger = Probot["log"];

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
  const { llm, maxTokensPerCall } = getLLM();
  const record: ReviewRecord = {
    repo: `${pr.owner}/${pr.repo}`,
    prNumber: pr.number,
    headSha: pr.headSha,
    status: "error",
    provider: llm.name,
    model: llm.model,
    secondPass: env.REVIEW_SECOND_PASS,
    filesReviewed: 0,
    filesSkipped: 0,
    totalLatencyMs: 0,
  };

  try {
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
    const { config, warning } = await loadRepoConfig(octokit, pr);
    const since = summary?.reviewedSha
      ? await changedSince(octokit, pr, summary.reviewedSha)
      : undefined;
    const collected = await collectFiles(octokit, pr, config, env.MAX_FILES_PER_REVIEW, since);
    log.info(
      { changed: collected.changedCount, reviewing: collected.files.length, incremental: !!since },
      "Selected files",
    );

    // 3. Run the two-pass review.
    const output = await runReview(
      llm,
      { title, files: collected.files },
      {
        secondPass: env.REVIEW_SECOND_PASS,
        confidenceThreshold: config.confidenceThreshold,
        severities: config.severities,
        maxInputTokens: env.MAX_INPUT_TOKENS_PER_REVIEW,
        maxTokensPerCall,
        onRetry: (attempt, delayMs, error) =>
          log.warn(
            { attempt, delayMs, error: (error as Error).message },
            "LLM call failed, retrying",
          ),
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
    const skipped = [...collected.skipped, ...output.skipped];
    const body = formatSummaryComment(output, {
      headSha: pr.headSha,
      model: llm.model,
      durationMs: Date.now() - started,
      reviewedFiles: collected.files.length - output.skipped.length,
      posted: fresh,
      alreadyPosted: output.findings.length - fresh.length,
      skipped,
      sinceSha: since ? summary?.reviewedSha : undefined,
      configWarning: warning,
      unposted: ok ? undefined : fresh,
    });
    await upsertSummaryComment(octokit, pr, body, summary, complete ? pr.headSha : undefined);

    Object.assign(record, {
      status: complete ? "completed" : "partial",
      filesReviewed: collected.files.length - output.skipped.length,
      filesSkipped: skipped.length,
      stats: output.stats,
      findings: output.findings.map((finding) => ({
        finding,
        posted: !postedBefore.has(finding.fingerprint),
      })),
    });
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
  } catch (error) {
    record.error = (error as Error).message;
    throw error;
  } finally {
    // Skipped commits return before a review starts and are not logged.
    if (record.stats || record.error) {
      record.totalLatencyMs = Date.now() - started;
      await logReview(env.DATABASE_URL, record).catch((error: Error) =>
        log.warn({ error: error.message }, "Could not write review log to Postgres"),
      );
    }
  }
}
