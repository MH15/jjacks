import { describe, expect, it } from "vitest";

import type { ExecuteSyncResult, SyncPlan } from "../src/domain";
import { renderDoctor, renderExecuteSummary, renderStatus, renderSyncPreview } from "../src/text";

const plan: SyncPlan = {
  localActions: ["fetch origin", "move main to main@origin"],
  githubActions: [
    {
      entry: {
        name: "feat/base",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "feat/base",
        parentBookmarkName: undefined,
        branchName: "feat/base",
        isCurrent: true,
      },
      intendedBaseBranch: "main",
      pullRequest: null,
      remoteBranchExists: false,
      needsBookmarkPush: true,
      actions: ["push bookmark", "create PR with base main"],
    },
  ],
  landedEntries: [],
  closedEntries: [],
  blockedEntries: [],
  hasExecutableWork: true,
  completionState: "active-stack",
};

const executeResult: ExecuteSyncResult = {
  pushedBookmarks: ["feat/base"],
  createdPullRequestBookmarks: ["feat/base"],
  updatedPullRequestNumbers: [],
  updatedCommentPullRequestNumbers: [12],
  warnings: [],
  plan,
  statusEntries: [],
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
    const output = renderSyncPreview({
      localActions: [],
      githubActions: [],
      landedEntries: [],
      closedEntries: [],
      blockedEntries: [],
      hasExecutableWork: false,
      completionState: "empty",
    });

    expect(output).toContain("no active bookmark stack");
    expect(output).toContain("jjacks create <bookmark-name>");
  });

  it("renders completed entries outside of GitHub actions", () => {
    const output = renderSyncPreview({
      localActions: ["fetch origin", "move main to main@origin", "edit main"],
      githubActions: [],
      landedEntries: [
        {
          entry: plan.githubActions[0]!.entry,
          pullRequest: {
            number: 12,
            url: "https://github.com/MH15/jjacks/pull/12",
            title: "feat/base",
            headRefName: "feat/base",
            baseRefName: "main",
            state: "MERGED",
            isDraft: false,
            body: "",
          },
          actions: ["PR #12 is merged; removed from active stack"],
        },
      ],
      closedEntries: [],
      blockedEntries: [],
      hasExecutableWork: true,
      completionState: "stack-complete",
    });

    expect(output).toContain("completed");
    expect(output).toContain("No syncable stack remains.");
    expect(output).toContain("next: jjacks create <bookmark-name>");
    expect(output).not.toContain("github\nfeat/base");
  });

  it("shows no changes for unchanged bookmarks", () => {
    const output = renderSyncPreview({
      localActions: [],
      githubActions: [
        {
          ...plan.githubActions[0]!,
          pullRequest: {
            number: 12,
            url: "https://github.com/MH15/jjacks/pull/12",
            title: "feat/base",
            headRefName: "feat/base",
            baseRefName: "main",
            isDraft: false,
            body: "",
          },
          remoteBranchExists: true,
          needsBookmarkPush: false,
          actions: [],
        },
      ],
      landedEntries: [],
      closedEntries: [],
      blockedEntries: [],
      hasExecutableWork: true,
      completionState: "active-stack",
    });

    expect(output).toContain("feat/base https://github.com/MH15/jjacks/pull/12");
    expect(output).toContain("- no changes");
  });
});

describe("renderStatus", () => {
  it("renders a friendly empty-state status when there is no active stack", () => {
    const output = renderStatus("/tmp/repo", []);

    expect(output).toContain("stack");
    expect(output).toContain("pull requests");
    expect(output).not.toContain("jjacks status");
    expect(output).toContain("no active bookmark stack");
    expect(output).toContain("jjacks create <bookmark-name>");
  });

  it("renders PR and blocker state as the stack dashboard", () => {
    const output = renderStatus("/tmp/repo", [
      {
        entry: {
          name: "feat/base",
          changeId: "aaa111",
          commitId: "111aaa",
          description: "feat/base",
          parentBookmarkName: undefined,
          branchName: "feat/base",
          isCurrent: false,
        },
        pullRequest: {
          number: 12,
          url: "https://github.com/MH15/jjacks/pull/12",
          title: "feat/base",
          headRefName: "feat/base",
          baseRefName: "main",
          isDraft: false,
          body: "",
        },
        remoteBranchExists: true,
        needsBookmarkPush: false,
      },
      {
        entry: {
          name: "feat/blocked",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "feat/blocked",
          parentBookmarkName: "feat/base",
          branchName: "feat/blocked",
          isCurrent: true,
          hasConflict: true,
        },
        pullRequest: null,
        remoteBranchExists: false,
        needsBookmarkPush: true,
        blockedBy: "feat/blocked",
      },
    ]);

    expect(output).toContain("feat/base");
    expect(output).toContain("PR #12");
    expect(output).toContain("base: main");
    expect(output).toContain("feat/blocked");
    expect(output).toContain("not pushed");
    expect(output).toContain("no PR yet");
    expect(output).toContain("blocked by local conflict");
  });
});

describe("renderDoctor", () => {
  it("renders checks without stack PR details", () => {
    const output = renderDoctor({
      repoRoot: "/tmp/repo",
      entries: [
        {
          entry: {
            name: "feat/base",
            changeId: "aaa111",
            commitId: "111aaa",
            description: "feat/base",
            parentBookmarkName: undefined,
            branchName: "feat/base",
            isCurrent: true,
          },
          pullRequest: {
            number: 12,
            url: "https://github.com/MH15/jjacks/pull/12",
            title: "feat/base",
            headRefName: "feat/base",
            baseRefName: "main",
            isDraft: false,
            body: "",
          },
          remoteBranchExists: true,
          needsBookmarkPush: false,
        },
      ],
    });

    expect(output).toContain("checks");
    expect(output).toContain("advance-bookmarks.enabled");
    expect(output).toContain("current stack entries: 1");
    expect(output).not.toContain("pull requests");
    expect(output).not.toContain("PR #12");
  });
});

describe("renderExecuteSummary", () => {
  it("renders a compact counts summary", () => {
    const output = renderExecuteSummary(executeResult);

    expect(output).toContain("1 push, 1 PR, 1 comment");
  });

  it("pluralizes zero pushes correctly", () => {
    const output = renderExecuteSummary({
      ...executeResult,
      pushedBookmarks: [],
      createdPullRequestBookmarks: [],
      updatedPullRequestNumbers: [],
      updatedCommentPullRequestNumbers: [],
    });

    expect(output).toContain("no pushes, no PRs, no comments");
  });

  it("includes warnings when non-fatal sync steps fail", () => {
    const output = renderExecuteSummary({
      ...executeResult,
      warnings: ["failed to sync stack comment for PR #12: API rate limit exceeded"],
    });

    expect(output).toContain("1 push, 1 PR, 1 comment");
    expect(output).toContain("warnings:");
    expect(output).toContain("failed to sync stack comment for PR #12");
  });
});
