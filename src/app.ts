import type { Context, Probot } from "probot";
import { upsertSummaryComment } from "./github/comments.js";
import { listChangedFiles } from "./github/pr.js";
import type { Octokit, PullRequestRef } from "./github/types.js";
import { getLLM } from "./llm/index.js";
import { formatSummaryComment, summarizePullRequest } from "./review/summary.js";

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
  const llm = getLLM((attempt, delayMs, error) =>
    log.warn({ attempt, delayMs, error: (error as Error).message }, "LLM call failed, retrying"),
  );
  const files = await listChangedFiles(octokit, pr);
  log.info({ files: files.length }, "Fetched changed files");

  let body: string;
  try {
    const result = await summarizePullRequest(llm, title, files);
    body = formatSummaryComment(result, {
      headSha: pr.headSha,
      model: llm.model,
      fileCount: files.length,
    });
    log.info(
      { inputTokens: result.inputTokens, outputTokens: result.outputTokens, ms: result.latencyMs },
      "Summary generated",
    );
  } catch (error) {
    log.error({ error: (error as Error).message }, "Review failed");
    body = `### SecondPass review\n\nSecondPass could not review commit ${pr.headSha.slice(0, 7)} (the model was unavailable). Push a new commit to try again.`;
  }
  await upsertSummaryComment(octokit, pr, body);
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
