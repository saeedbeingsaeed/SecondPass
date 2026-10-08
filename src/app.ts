import type { Context, Probot } from "probot";
import { upsertSummaryComment } from "./github/comments.js";
import { getFileContent, listChangedFiles } from "./github/pr.js";
import { postInlineReview } from "./github/review.js";
import type { Octokit, PullRequestRef } from "./github/types.js";
import { getLLM } from "./llm/index.js";
import { formatSummaryComment } from "./review/format.js";
import { runReview, type FileForReview } from "./review/pipeline.js";

type Logger = Probot["log"];

// Reviews currently running in this process, keyed by repo, PR and commit.
// GitHub can redeliver a webhook; this stops the same commit being reviewed twice at once.
const inFlight = new Set<string>();

async function reviewPullRequest(
  octokit: Octokit,
  pr: PullRequestRef,
  title: string,
  log: Logger,
): Promise<void> {
  const started = Date.now();
  const llm = getLLM((attempt, delayMs, error) =>
    log.warn({ attempt, delayMs, error: (error as Error).message }, "LLM call failed, retrying"),
  );

  const changed = await listChangedFiles(octokit, pr);
  const files: FileForReview[] = [];
  for (const file of changed) {
    // No patch means a binary or a diff too large for GitHub to show.
    if (!file.patch || file.status === "removed") continue;
    const content = await getFileContent(octokit, pr, file.filename);
    files.push({ path: file.filename, patch: file.patch, content });
  }
  log.info({ changed: changed.length, reviewing: files.length }, "Fetched changed files");

  const output = await runReview(llm, { title, files });
  const posted = await postInlineReview(octokit, pr, output.findings);
  if (!posted) log.warn("GitHub rejected inline comments; listing them in the summary instead");

  const body = formatSummaryComment(output, {
    headSha: pr.headSha,
    model: llm.model,
    fileCount: files.length,
    durationMs: Date.now() - started,
    unposted: posted ? undefined : output.findings,
  });
  await upsertSummaryComment(octokit, pr, body);
  // Counts only: never log code, prompts or model output.
  log.info(
    {
      findings: output.findings.length,
      ...output.stats,
      failedFiles: output.stats.failedFiles.length,
      ms: Date.now() - started,
    },
    "Review posted",
  );
}

export default function app(probot: Probot): void {
  // Without a secret Probot falls back to the public default "development",
  // which would let anyone send us fake webhooks.
  if (!process.env.WEBHOOK_SECRET) {
    throw new Error("WEBHOOK_SECRET is not set. See .env.example.");
  }

  probot.on(
    ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"],
    async (context: Context<"pull_request">) => {
      const { pull_request: pull, repository } = context.payload;
      const pr: PullRequestRef = {
        owner: repository.owner.login,
        repo: repository.name,
        number: pull.number,
        headSha: pull.head.sha,
      };
      const key = `${pr.owner}/${pr.repo}#${pr.number}@${pr.headSha}`;
      const log = context.log.child({ pr: key });
      if (inFlight.has(key)) {
        log.info("Review already running for this commit, skipping");
        return;
      }

      // Answer the webhook right away and review in the background. A review
      // can take minutes because of rate limits; GitHub gives up after 10s.
      inFlight.add(key);
      log.info({ action: context.payload.action }, "Starting review");
      reviewPullRequest(context.octokit, pr, pull.title, log)
        .catch((error: Error) => log.error({ error: error.message }, "Review job crashed"))
        .finally(() => inFlight.delete(key));
    },
  );
}
