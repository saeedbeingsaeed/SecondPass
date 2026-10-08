import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApplicationFunctionOptions, Context, Probot } from "probot";
import type { PullRequestRef } from "./github/types.js";
import { getLLM } from "./llm/index.js";
import { reviewPullRequest } from "./review-job.js";

// The tail of each PR's job chain. Jobs for the same PR run one after another,
// so a push during a review waits, then reviews only what changed.
const prQueues = new Map<string, Promise<void>>();

function enqueue(key: string, job: () => Promise<void>): void {
  const previous = prQueues.get(key) ?? Promise.resolve();
  const next = previous.then(job);
  prQueues.set(key, next);
  void next.finally(() => {
    if (prQueues.get(key) === next) prQueues.delete(key);
  });
}

// GET / answers with a short status page, so opening the deployed URL in a
// browser shows the bot is up instead of a blank 404.
export function homePage(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== "GET" || req.url?.split("?")[0] !== "/") return false;
  res
    .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
    .end(
      "SecondPass is running.\n\n" +
        "This service has no web interface. GitHub sends pull request events to\n" +
        "/api/github/webhooks, and /ping is the health check.\n",
    );
  return true;
}

export default function app(probot: Probot, options?: ApplicationFunctionOptions): void {
  // Without a secret Probot falls back to the public default "development",
  // which would let anyone send us fake webhooks.
  if (!process.env.WEBHOOK_SECRET) {
    throw new Error("WEBHOOK_SECRET is not set. See .env.example.");
  }
  // Check settings and the chosen provider's key and model now, so a mistake
  // in .env stops the app at startup instead of failing every review.
  const { llm } = getLLM();
  probot.log.info(`Using ${llm.name} (${llm.model})`);
  options?.addHandler(homePage);

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
      const prKey = `${pr.owner}/${pr.repo}#${pr.number}`;
      const log = context.log.child({ pr: prKey, sha: pr.headSha.slice(0, 7) });

      // Answer the webhook right away and review in the background. A review
      // can take minutes because of rate limits; GitHub gives up after 10s.
      log.info({ action: context.payload.action }, "Queued review");
      enqueue(prKey, () =>
        reviewPullRequest(context.octokit, pr, pull.title, log).catch((error: Error) =>
          log.error({ error: error.message }, "Review job crashed"),
        ),
      );
    },
  );
}
