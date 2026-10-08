// Evaluation harness: runs the review pipeline on PRs with a known bug,
// without posting anything to GitHub, and reports recall, comments and tokens.
//
//   npm run eval
//   npm run eval -- --provider gemini,groq --second-pass both
//   npm run eval -- --cases eval/cases.json --tolerance 2
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { ProbotOctokit } from "probot";
import { getEnv, type ProviderName } from "../src/config.js";
import { collectFiles, loadRepoConfig, type CollectedFiles } from "../src/github/collect.js";
import type { Octokit, PullRequestRef } from "../src/github/types.js";
import { getLLM } from "../src/llm/index.js";
import { runReview } from "../src/review/pipeline.js";
import type { RepoConfig } from "../src/review/repo-config.js";
import {
  catchesBug,
  EvalCasesSchema,
  formatSummaryTable,
  summarize,
  type CaseResult,
  type EvalCase,
  type RunSummary,
} from "./metrics.js";

const { values: args } = parseArgs({
  options: {
    cases: { type: "string", default: "eval/cases.json" },
    // Comma-separated: gemini, groq. Defaults to LLM_PROVIDER.
    provider: { type: "string" },
    "second-pass": { type: "string", default: "both" },
    // Extra lines on each side of the bug's range that still count as caught.
    tolerance: { type: "string", default: "0" },
  },
});

if (existsSync(".env")) process.loadEnvFile(".env");
const env = getEnv();

const providers = (args.provider ?? env.LLM_PROVIDER).split(",").map((p) => p.trim());
for (const p of providers) {
  if (p !== "gemini" && p !== "groq") throw new Error(`Unknown provider "${p}"`);
}
const passModes = { on: [true], off: [false], both: [true, false] }[args["second-pass"]];
if (!passModes) throw new Error(`--second-pass must be on, off or both`);
const tolerance = Number(args.tolerance);

const cases = EvalCasesSchema.parse(JSON.parse(readFileSync(args.cases, "utf8")));

// Public repos work without a token, but GitHub allows only 60 requests an hour.
const token = process.env.GITHUB_TOKEN;
const octokit = new ProbotOctokit(token ? { auth: { token } } : {}) as unknown as Octokit;

interface PreparedCase {
  evalCase: EvalCase;
  id: string;
  title: string;
  config: RepoConfig;
  collected: CollectedFiles;
}

// Fetch each PR once and reuse it for every provider and pass-2 setting, so
// every configuration reviews exactly the same input.
async function prepare(evalCase: EvalCase): Promise<PreparedCase> {
  const [owner, repo] = evalCase.repo.split("/") as [string, string];
  const { data } = await octokit.rest.pulls.get({ owner, repo, pull_number: evalCase.pr });
  const pr: PullRequestRef = { owner, repo, number: evalCase.pr, headSha: data.head.sha };
  const { config } = await loadRepoConfig(octokit, pr);
  const collected = await collectFiles(octokit, pr, config, env.MAX_FILES_PER_REVIEW);
  return { evalCase, id: `${evalCase.repo}#${evalCase.pr}`, title: data.title, config, collected };
}

async function runCase(
  c: PreparedCase,
  provider: ProviderName,
  secondPass: boolean,
): Promise<CaseResult> {
  const { llm, maxTokensPerCall } = getLLM(provider);
  const started = Date.now();
  const output = await runReview(
    llm,
    { title: c.title, files: c.collected.files },
    {
      secondPass,
      confidenceThreshold: c.config.confidenceThreshold,
      severities: c.config.severities,
      maxInputTokens: env.MAX_INPUT_TOKENS_PER_REVIEW,
      maxTokensPerCall,
      onRetry: (attempt, delayMs) =>
        console.log(`    retry ${attempt} in ${(delayMs / 1000).toFixed(0)}s (rate limited)`),
    },
  );
  return {
    caseId: c.id,
    caught: catchesBug(output.findings, c.evalCase.bug, tolerance),
    comments: output.findings.length,
    pass1Findings: output.stats.pass1Findings,
    tokens: output.stats.inputTokens + output.stats.outputTokens,
    llmCalls: output.stats.llmCalls,
    latencyMs: Date.now() - started,
    failed: output.stats.failedFiles.length > 0,
  };
}

async function main() {
  console.log(`Fetching ${cases.length} PRs...`);
  const prepared: PreparedCase[] = [];
  for (const c of cases) prepared.push(await prepare(c));

  const summaries: RunSummary[] = [];
  const details: { run: RunSummary; results: CaseResult[] }[] = [];
  for (const provider of providers as ProviderName[]) {
    for (const secondPass of passModes!) {
      const { llm } = getLLM(provider);
      console.log(`\n== ${provider} (${llm.model}), pass 2 ${secondPass ? "on" : "off"}`);
      const results: CaseResult[] = [];
      for (const c of prepared) {
        const r = await runCase(c, provider, secondPass);
        results.push(r);
        console.log(
          `  ${r.caught ? "CAUGHT" : "missed"}  ${r.caseId}  ` +
            `${r.comments} comments (${r.pass1Findings} before filtering), ` +
            `${r.tokens.toLocaleString("en-US")} tokens${r.failed ? ", MODEL FAILED" : ""}`,
        );
      }
      const summary = summarize({ provider, model: llm.model, secondPass }, results);
      summaries.push(summary);
      details.push({ run: summary, results });
    }
  }

  console.log(`\n${formatSummaryTable(summaries)}\n`);
  mkdirSync("eval/results", { recursive: true });
  const file = `eval/results/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify({ tolerance, details }, null, 2));
  console.log(`Full results written to ${file}`);
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
