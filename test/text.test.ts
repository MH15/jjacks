import { describe, expect, it } from "vitest";

import type { ExecuteSyncResult, SyncPlan } from "../src/domain";
import { renderExecuteSummary, renderStatus, renderSyncPreview } from "../src/text";

const plan: SyncPlan = {
  stack: [
    {
      entry: {
        name: "feat/base",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "feat/base",
        parentBookmarkName: undefined,
        branchName: "feat/base",
        isCurrent: true
      },
      intendedBaseBranch: "main",
      pullRequest: null,
      remoteBranchExists: false,
      needsBookmarkPush: true,
      actions: ["push bookmark", "create PR with base main"]
    }
  ]
};

const executeResult: ExecuteSyncResult = {
  pushedBookmarks: ["feat/base"],
  createdPullRequestBookmarks: ["feat/base"],
  updatedPullRequestNumbers: [],
  updatedCommentPullRequestNumbers: [12],
  warnings: [],
  plan,
  statusEntries: []
};

describe("renderSyncPreview", () => {
  it("renders each bookmark with only meaningful actions", () => {
    const output = renderSyncPreview(plan);

    expect(output).toContain("jjacks sync plan");
    expect(output).toContain("feat/base");
    expect(output).toContain("- push bookmark");
    expect(output).toContain("- create PR with base main");
  });

  it("renders a friendly empty-state preview when there is no active stack", () => {
    const output = renderSyncPreview({ stack: [] });

    expect(output).toContain("no active bookmark stack");
    expect(output).toContain("jjacks create <bookmark-name>");
  });

  it("shows no changes for unchanged bookmarks", () => {
    const output = renderSyncPreview({
      stack: [
        {
          ...plan.stack[0]!,
          pullRequest: {
            number: 12,
            url: "https://github.com/MH15/jjacks/pull/12",
            title: "feat/base",
            headRefName: "feat/base",
            baseRefName: "main",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false,
          actions: []
        }
      ]
    });

    expect(output).toContain("feat/base (PR #12)");
    expect(output).toContain("- no changes");
  });
});

describe("renderStatus", () => {
  it("renders a friendly empty-state status when there is no active stack", () => {
    const output = renderStatus("/tmp/repo", []);

    expect(output).toContain("jjacks status");
    expect(output).toContain("no active bookmark stack");
    expect(output).toContain("jjacks create <bookmark-name>");
  });
});

describe("renderExecuteSummary", () => {
  it("renders a compact counts summary", () => {
    const output = renderExecuteSummary(executeResult);

    expect(output).toContain("1 push, 1 PR, 1 comment");
  });

  it("includes warnings when non-fatal sync steps fail", () => {
    const output = renderExecuteSummary({
      ...executeResult,
      warnings: ["failed to sync stack comment for PR #12: API rate limit exceeded"]
    });

    expect(output).toContain("1 push, 1 PR, 1 comment");
    expect(output).toContain("warnings:");
    expect(output).toContain("failed to sync stack comment for PR #12");
  });
});
