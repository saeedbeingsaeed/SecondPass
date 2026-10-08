import { describe, expect, it, vi } from "vitest";
import { SUMMARY_MARKER, upsertSummaryComment } from "../src/github/comments.js";
import type { Octokit } from "../src/github/types.js";

function fakeOctokit(existing: { id: number; body: string; user: { type: string } }[]) {
  const createComment = vi.fn();
  const updateComment = vi.fn();
  const octokit = {
    paginate: vi.fn().mockResolvedValue(existing),
    rest: { issues: { listComments: vi.fn(), createComment, updateComment } },
  } as unknown as Octokit;
  return { octokit, createComment, updateComment };
}

const pr = { owner: "o", repo: "r", number: 1, headSha: "abc" };

describe("upsertSummaryComment", () => {
  it("creates a comment when the bot has none yet", async () => {
    const { octokit, createComment, updateComment } = fakeOctokit([]);
    await upsertSummaryComment(octokit, pr, "hello");
    expect(createComment).toHaveBeenCalledOnce();
    expect(createComment.mock.calls[0]![0].body).toContain(SUMMARY_MARKER);
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("updates the bot's existing summary instead of posting a duplicate", async () => {
    const { octokit, createComment, updateComment } = fakeOctokit([
      { id: 1, body: `quoted ${SUMMARY_MARKER}`, user: { type: "User" } },
      { id: 2, body: `old ${SUMMARY_MARKER}`, user: { type: "Bot" } },
    ]);
    await upsertSummaryComment(octokit, pr, "new");
    expect(updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 2 }));
    expect(createComment).not.toHaveBeenCalled();
  });
});
