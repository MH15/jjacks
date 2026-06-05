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
    expect(output).toContain("fetched origin");
    expect(output).toContain("moved main to main@origin");
    expect(output).toContain("no remaining stack found; created a fresh working-copy change on main");
    expect(output).toContain("rebased @ onto main");
    expect(output).toContain("current jj state");
  });

  it("renders the continue-stack steps and resulting jj state", () => {
    const output = renderRefreshSummary(
      {
        kind: "continue-stack",
        defaultBranch: "main",
        rootBookmarkName: "feat/base",
        tipBookmarkName: "feat/ui"
      },
      "abcd1234 user@example.com 2026-06-04\nContinue feat/ui\nfeat/ui efgh5678 Existing stack tip"
    );

    expect(output).toContain("jjacks refresh");
    expect(output).toContain("moved main to main@origin");
    expect(output).toContain("restacked remaining stack from feat/base onto main");
    expect(output).toContain("created a fresh working-copy change to continue feat/ui");
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
          isDraft: false
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
          isDraft: false
        },
        remoteBranchExists: true,
        needsBookmarkPush: false
      }
    ];

    expect(resolveRefreshPlan(entries, "main")).toEqual({
      kind: "continue-stack",
      defaultBranch: "main",
      rootBookmarkName: "feat/base",
      tipBookmarkName: "feat/ui"
    });
  });
});
