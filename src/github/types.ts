import type { ProbotOctokit } from "probot";

export type Octokit = InstanceType<typeof ProbotOctokit>;

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
}
