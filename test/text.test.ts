import { describe, expect, it } from "vitest";

import type { ExecuteSyncResult, SyncPlan } from "../src/domain";
import { renderExecuteSummary, renderSyncPreview } from "../src/text";

const plan: SyncPlan = {
  stack: [
    {
      entry: {
        name: "feat/base",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "feat/base",
        parentBookmarkName: undefined,
        branchName: "feat/base"
      },
      intendedBaseBranch: "main",
      pullRequest: null,
      remoteBranchExists: false,
      needsBookmarkPush: true,
      actions: ['create PR titled "feat/base" with base main']
    }
  ]
};

const executeResult: ExecuteSyncResult = {
  pushedBookmarks: ["feat/base"],
  createdPullRequestBookmarks: ["feat/base"],
  updatedPullRequestNumbers: [],
  updatedCommentPullRequestNumbers: [12],
  plan,
  statusEntries: []
};

describe("renderSyncPreview", () => {
  it("includes both the plan and stack comment preview", () => {
    const output = renderSyncPreview(plan, "<!-- jjacks:stack -->\n- pending");

    expect(output).toContain("jjacks sync plan");
    expect(output).toContain("stack comment preview");
    expect(output).toContain("<!-- jjacks:stack -->");
  });
});

describe("renderExecuteSummary", () => {
  it("describes branch pushes as PR content updates and distinguishes metadata updates", () => {
    const output = renderExecuteSummary(executeResult);

    expect(output).toContain("pushed bookmarks (PR contents updated via branch push):");
    expect(output).toContain("created pull requests:");
    expect(output).toContain("no PR metadata updates were needed");
    expect(output).toContain("updated stack comments:");
  });
});
