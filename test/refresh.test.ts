import { describe, expect, it } from "vitest";

import type { StackStatusEntry } from "../src/domain";
import { renderRefreshSummary, resolveRefreshPlan } from "../src/refresh";

describe("renderRefreshSummary", () => {
  it("renders the clean-trunk fallback steps and resulting jj state", () => {
    const output = renderRefreshSummary(
      {
        kind: "clean-trunk",
        defaultBranch: "main"
      },
      "abcd1234 user@example.com 2026-06-04\nStart next change from main\nmain efgh5678 Merge pull request"
    );

    expect(output).toContain("jjacks refresh");
    expect(output).toContain("refreshed main from origin");
    expect(output).toContain("no remaining stack; continuing from main");
    expect(output).toContain("current jj state");
  });

  it("renders the continue-stack steps and resulting jj state", () => {
    const output = renderRefreshSummary(
      {
        kind: "continue-stack",
        defaultBranch: "main",
        rootBookmarkName: "feat/base",
        currentBookmarkName: "feat/ui"
      },
      "abcd1234 user@example.com 2026-06-04\nContinue feat/ui\nfeat/ui efgh5678 Existing stack tip"
    );

    expect(output).toContain("jjacks refresh");
    expect(output).toContain("refreshed main from origin");
    expect(output).toContain("restacked remaining stack onto main");
    expect(output).toContain("continuing feat/ui");
    expect(output).toContain("current jj state");
  });
});

describe("resolveRefreshPlan", () => {
  it("falls back to clean trunk when no active stack remains", () => {
    expect(resolveRefreshPlan([], "main")).toEqual({
      kind: "clean-trunk",
      defaultBranch: "main"
    });
  });

  it("continues from the surviving stack when bookmarks remain", () => {
    const entries: ReadonlyArray<StackStatusEntry> = [
      {
        entry: {
          name: "feat/base",
          changeId: "aaa111",
          commitId: "111aaa",
          description: "feat/base",
          parentBookmarkName: undefined,
          branchName: "feat/base",
          isCurrent: false
        },
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
        needsBookmarkPush: false
      },
      {
        entry: {
          name: "feat/ui",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "feat/ui",
          parentBookmarkName: "feat/base",
          branchName: "feat/ui",
          isCurrent: true
        },
        pullRequest: {
          number: 13,
          url: "https://github.com/MH15/jjacks/pull/13",
          title: "feat/ui",
          headRefName: "feat/ui",
          baseRefName: "feat/base",
          isDraft: false,
          body: ""
        },
        remoteBranchExists: true,
        needsBookmarkPush: false
      }
    ];

    expect(resolveRefreshPlan(entries, "main")).toEqual({
      kind: "continue-stack",
      defaultBranch: "main",
      rootBookmarkName: "feat/base",
      currentBookmarkName: "feat/ui"
    });
  });

  it("keeps the surviving middle-to-tip stack after the bottom layer is merged away", () => {
    const entries: ReadonlyArray<StackStatusEntry> = [
      {
        entry: {
          name: "mh/inquirer",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "mh/inquirer",
          parentBookmarkName: "mh/refrehs-fixes",
          branchName: "mh/inquirer",
          isCurrent: false
        },
        pullRequest: {
          number: 17,
          url: "https://github.com/MH15/jjacks/pull/17",
          title: "mh/inquirer",
          headRefName: "mh/inquirer",
          baseRefName: "mh/refrehs-fixes",
          isDraft: false,
          body: ""
        },
        remoteBranchExists: true,
        needsBookmarkPush: true
      },
      {
        entry: {
          name: "mh/ancestors",
          changeId: "ccc333",
          commitId: "333ccc",
          description: "mh/ancestors",
          parentBookmarkName: "mh/inquirer",
          branchName: "mh/ancestors",
          isCurrent: true
        },
        pullRequest: {
          number: 18,
          url: "https://github.com/MH15/jjacks/pull/18",
          title: "mh/ancestors",
          headRefName: "mh/ancestors",
          baseRefName: "mh/inquirer",
          isDraft: false,
          body: ""
        },
        remoteBranchExists: true,
        needsBookmarkPush: true
      }
    ];

    expect(resolveRefreshPlan(entries, "main")).toEqual({
      kind: "continue-stack",
      defaultBranch: "main",
      rootBookmarkName: "mh/inquirer",
      currentBookmarkName: "mh/ancestors"
    });
  });

  it("continues from the current bookmark even when sibling children are present", () => {
    const entries: ReadonlyArray<StackStatusEntry> = [
      {
        entry: {
          name: "feat/base",
          changeId: "aaa111",
          commitId: "111aaa",
          description: "feat/base",
          parentBookmarkName: undefined,
          branchName: "feat/base",
          isCurrent: false
        },
        pullRequest: null,
        remoteBranchExists: true,
        needsBookmarkPush: false
      },
      {
        entry: {
          name: "feat/right",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "feat/right",
          parentBookmarkName: "feat/base",
          branchName: "feat/right",
          isCurrent: true
        },
        pullRequest: null,
        remoteBranchExists: true,
        needsBookmarkPush: false
      },
      {
        entry: {
          name: "feat/left",
          changeId: "ccc333",
          commitId: "333ccc",
          description: "feat/left",
          parentBookmarkName: "feat/base",
          branchName: "feat/left",
          isCurrent: false
        },
        pullRequest: null,
        remoteBranchExists: true,
        needsBookmarkPush: false
      }
    ];

    expect(resolveRefreshPlan(entries, "main")).toEqual({
      kind: "continue-stack",
      defaultBranch: "main",
      rootBookmarkName: "feat/base",
      currentBookmarkName: "feat/right"
    });
  });
});
