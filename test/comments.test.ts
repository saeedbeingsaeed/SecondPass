import { describe, expect, it, vi } from "vitest";
import { findSummary, summaryMarker, upsertSummaryComment } from "../src/github/comments.js";
import type { Octokit } from "../src/github/types.js";

const bot = { type: "Bot" };
const pr = { owner: "o", repo: "r", number: 1, headSha: "abc1234" };

describe("findSummary", () => {
  it("finds the bot's summary and the commit it reviewed", () => {
    const found = findSummary([
      { id: 1, body: "hello", user: bot },
      { id: 2, body: `x\n${summaryMarker("abc1234def")}`, user: bot },
    ]);
    expect(found).toEqual({ id: 2, reviewedSha: "abc1234def" });
  });

  it("ignores a human quoting the marker", () => {
    expect(
      findSummary([{ id: 1, body: summaryMarker("abc1234"), user: { type: "User" } }]),
    ).toBeUndefined();
  });

  it("handles a summary with no reviewed commit recorded", () => {
    expect(findSummary([{ id: 3, body: summaryMarker(), user: bot }])).toEqual({
      id: 3,
      reviewedSha: undefined,
    });
  });
});

describe("upsertSummaryComment", () => {
  function fakeOctokit() {
    const createComment = vi.fn();
    const updateComment = vi.fn();
    const octokit = { rest: { issues: { createComment, updateComment } } } as unknown as Octokit;
    return { octokit, createComment, updateComment };
  }

  it("creates a comment when there is none, recording the reviewed commit", async () => {
    const { octokit, createComment, updateComment } = fakeOctokit();
    await upsertSummaryComment(octokit, pr, "hello", undefined, "abc1234");
    expect(createComment.mock.calls[0]![0].body).toContain(summaryMarker("abc1234"));
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("updates the existing summary instead of posting a duplicate", async () => {
    const { octokit, createComment, updateComment } = fakeOctokit();
    await upsertSummaryComment(octokit, pr, "new", { id: 2 });
    expect(updateComment).toHaveBeenCalledWith(expect.objectContaining({ comment_id: 2 }));
    expect(createComment).not.toHaveBeenCalled();
  });
});
