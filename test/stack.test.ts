import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import type { RepoInfo, StackEntry } from "../src/domain.js";
import { renderStackComment, stackCommentMarker } from "../src/stack.js";
import { GitService } from "../src/services/GitService.js";
import { GitHubService } from "../src/services/GitHubService.js";
import { JjService } from "../src/services/JjService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { RepoService } from "../src/services/RepoService.js";
import { StackService, StackServiceLive } from "../src/services/StackService.js";

const stack: ReadonlyArray<StackEntry> = [
  {
    name: "feat/base",
    changeId: "aaa111",
    commitId: "111aaa",
    parentBookmarkName: undefined,
    branchName: "feat/base"
  },
  {
    name: "feat/ui",
    changeId: "bbb222",
    commitId: "222bbb",
    parentBookmarkName: "feat/base",
    branchName: "feat/ui"
  }
];

const repoInfo: RepoInfo = {
  root: "/tmp/repo",
  gitRemote: "https://github.com/MH15/jjacks.git",
  defaultBranch: "main"
};

const makeLayer = (options?: {
  readonly initiallyPushed?: ReadonlyArray<string>;
  readonly existingChildPr?: {
    readonly title: string;
    readonly baseRefName: string;
  };
}) => {
  const pushedBranches = new Set(options?.initiallyPushed ?? ["feat/base"]);
  const pushedBookmarks: Array<string> = [];
  const pullRequests = new Map<
    string,
    {
      number: number;
      url: string;
      title: string;
      headRefName: string;
      baseRefName: string;
      isDraft: boolean;
    }
  >([
    [
      "feat/base",
      {
        number: 12,
        url: "https://github.com/MH15/jjacks/pull/12",
        title: "feat/base",
        headRefName: "feat/base",
        baseRefName: "main",
        isDraft: false
      }
    ]
  ]);

  if (options?.existingChildPr !== undefined) {
    pullRequests.set("feat/ui", {
      number: 13,
      url: "https://github.com/MH15/jjacks/pull/13",
      title: options.existingChildPr.title,
      headRefName: "feat/ui",
      baseRefName: options.existingChildPr.baseRefName,
      isDraft: false
    });
  }
  const createdPullRequests: Array<string> = [];
  const updatedPullRequests: Array<number> = [];

  const jjLayer = Layer.succeed(JjService, {
    getCurrentStack: Effect.succeed(stack)
  });

  const repoLayer = Layer.succeed(RepoService, {
    getRepoInfo: Effect.succeed(repoInfo)
  });

  const githubLayer = Layer.succeed(GitHubService, {
    findPullRequestByHead: (branchName: string) => Effect.succeed(pullRequests.get(branchName) ?? null),
    createPullRequest: ({ headBranch, baseBranch, title }) =>
      Effect.sync(() => {
        const number = pullRequests.size + 12;
        const created = {
          number,
          url: `https://github.com/MH15/jjacks/pull/${number}`,
          title,
          headRefName: headBranch,
          baseRefName: baseBranch,
          isDraft: false
        };
        pullRequests.set(headBranch, created);
        createdPullRequests.push(headBranch);
        return created;
      }),
    updatePullRequest: ({ number, baseBranch, title }) =>
      Effect.sync(() => {
        for (const [headBranch, pr] of pullRequests.entries()) {
          if (pr.number === number) {
            pullRequests.set(headBranch, {
              ...pr,
              baseRefName: baseBranch ?? pr.baseRefName,
              title: title ?? pr.title
            });
            updatedPullRequests.push(number);
            return;
          }
        }
      })
  });

  const gitLayer = Layer.succeed(GitService, {
    remoteBranchExists: (branchName: string) => Effect.succeed(pushedBranches.has(branchName)),
    pushBookmark: (bookmarkName: string) =>
      Effect.sync(() => {
        pushedBookmarks.push(bookmarkName);
        pushedBranches.add(bookmarkName);
      })
  });

  const processLayer = Layer.succeed(ProcessService, {
    run: () =>
      Effect.die("ProcessService should not be used when fake JJ/GitHub/Repo services are provided.")
  });

  return {
    layer: Layer.mergeAll(jjLayer, repoLayer, gitLayer, githubLayer, processLayer, StackServiceLive),
    pushedBookmarks,
    createdPullRequests,
    updatedPullRequests
  };
};

describe("StackService with injected fakes", () => {
  it("builds a sync plan using DI-provided services", async () => {
    const plan = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.buildSyncPlan;
      }).pipe(Effect.provide(makeLayer().layer))
    );

    expect(plan.stack).toHaveLength(2);
    expect(plan.stack[0]).toMatchObject({
      intendedBaseBranch: "main",
      remoteBranchExists: true
    });
    expect(plan.stack[0]?.actions).not.toContainEqual(expect.stringContaining('create PR titled "feat/base"'));
    expect(plan.stack[1]).toMatchObject({
      intendedBaseBranch: "feat/base",
      remoteBranchExists: false
    });
    expect(plan.stack[1]?.actions).toContain('push bookmark with "jj git push --bookmark feat/ui" before opening or updating its PR');
    expect(plan.stack[1]?.actions).toContain('create PR titled "feat/ui" with base feat/base');
  });

  it("returns repo-scoped status entries with PR lookup results", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.getStatus;
      }).pipe(Effect.provide(makeLayer().layer))
    );

    expect(status.repoRoot).toBe("/tmp/repo");
    expect(status.entries[0]?.pullRequest?.number).toBe(12);
    expect(status.entries[0]?.remoteBranchExists).toBe(true);
    expect(status.entries[1]?.pullRequest).toBeNull();
    expect(status.entries[1]?.remoteBranchExists).toBe(false);
  });

  it("pushes missing bookmarks during execute sync and refreshes status", async () => {
    const harness = makeLayer();
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.executeSync;
      }).pipe(Effect.provide(harness.layer))
    );

    expect(harness.pushedBookmarks).toEqual(["feat/ui"]);
    expect(harness.createdPullRequests).toEqual(["feat/ui"]);
    expect(harness.updatedPullRequests).toEqual([]);
    expect(result.pushedBookmarks).toEqual(["feat/ui"]);
    expect(result.createdPullRequestBookmarks).toEqual(["feat/ui"]);
    expect(result.updatedPullRequestNumbers).toEqual([]);
    expect(result.statusEntries.every((entry) => entry.remoteBranchExists)).toBe(true);
    expect(result.statusEntries[1]?.pullRequest?.headRefName).toBe("feat/ui");
  });

  it("updates existing PR metadata instead of creating a duplicate", async () => {
    const harness = makeLayer({
      initiallyPushed: ["feat/base", "feat/ui"],
      existingChildPr: {
        title: "old title",
        baseRefName: "main"
      }
    });
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.executeSync;
      }).pipe(Effect.provide(harness.layer))
    );

    expect(harness.createdPullRequests).toEqual([]);
    expect(harness.updatedPullRequests).toEqual([13]);
    expect(result.createdPullRequestBookmarks).toEqual([]);
    expect(result.updatedPullRequestNumbers).toEqual([13]);
    expect(result.statusEntries[1]?.pullRequest?.title).toBe("feat/ui");
    expect(result.statusEntries[1]?.pullRequest?.baseRefName).toBe("feat/base");
  });
});

describe("renderStackComment", () => {
  it("renders a stable comment body with current marker and pending PRs", () => {
    const comment = renderStackComment([
      {
        entry: stack[0]!,
        pullRequest: {
          number: 12,
          url: "https://github.com/MH15/jjacks/pull/12",
          title: "feat/base",
          headRefName: "feat/base",
          baseRefName: "main",
          isDraft: false
        },
        remoteBranchExists: true
      },
      {
        entry: stack[1]!,
        pullRequest: null,
        remoteBranchExists: false
      }
    ]);

    expect(comment).toContain(stackCommentMarker);
    expect(comment).toContain("[#12](https://github.com/MH15/jjacks/pull/12) `feat/base`");
    expect(comment).toContain("**current** `feat/ui` -> pending PR");
  });
});
