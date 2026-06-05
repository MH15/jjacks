import { describe, expect, it } from "vitest";
import { Cause, Effect, Layer } from "effect";

import type { PullRequestComment, RepoInfo, StackEntry } from "../src/domain";
import { CliError } from "../src/errors";
import { renderStackComment, stackCommentMarker } from "../src/stack";
import { GitService } from "../src/services/GitService";
import { GitHubService } from "../src/services/GitHubService";
import { JjService } from "../src/services/JjService";
import { ProcessService } from "../src/services/ProcessService";
import { RepoService } from "../src/services/RepoService";
import { StackService, StackServiceLive } from "../src/services/StackService";

const stack: ReadonlyArray<StackEntry> = [
  {
    name: "feat/base",
    changeId: "aaa111",
    commitId: "111aaa",
    description: "feat/base",
    parentBookmarkName: undefined,
    branchName: "feat/base"
  },
  {
    name: "feat/ui",
    changeId: "bbb222",
    commitId: "222bbb",
    description: "feat/ui",
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
  const issueComments = new Map<number, Array<PullRequestComment>>([
    [
      12,
      [
        {
          id: 1001,
          url: "https://github.com/MH15/jjacks/issues/comments/1001",
          body: "old comment"
        }
      ]
    ]
  ]);
  const updatedCommentPullRequests: Array<number> = [];
  const describedBookmarks: Array<string> = [];

  const jjLayer = Layer.succeed(JjService, {
    ensureAdvanceBookmarksEnabled: Effect.void,
    getCurrentStack: Effect.succeed(stack),
    ensureBookmarkDescription: (bookmarkName: string) =>
      Effect.sync(() => {
        describedBookmarks.push(bookmarkName);
      }),
    createBookmark: () => Effect.void,
    moveUp: Effect.succeed(""),
    moveDown: Effect.succeed(""),
    refreshToRemoteBookmark: () => Effect.succeed(""),
    diffCurrentStack: () => Effect.succeed("")
  });

  const repoLayer = Layer.succeed(RepoService, {
    fetchOrigin: Effect.void,
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
      }),
    listIssueComments: (pullRequestNumber: number) => Effect.succeed(issueComments.get(pullRequestNumber) ?? []),
    createIssueComment: ({ pullRequestNumber, body }) =>
      Effect.sync(() => {
        const comments = issueComments.get(pullRequestNumber) ?? [];
        comments.push({
          id: pullRequestNumber * 1000,
          url: `https://github.com/MH15/jjacks/issues/comments/${pullRequestNumber * 1000}`,
          body
        });
        issueComments.set(pullRequestNumber, comments);
        updatedCommentPullRequests.push(pullRequestNumber);
      }),
    updateIssueComment: ({ commentId, body }) =>
      Effect.sync(() => {
        for (const [pullRequestNumber, comments] of issueComments.entries()) {
          const existing = comments.find((comment) => comment.id === commentId);
          if (existing !== undefined) {
            existing.body = body;
            updatedCommentPullRequests.push(pullRequestNumber);
            return;
          }
        }
      })
  });

  const gitLayer = Layer.succeed(GitService, {
    getBookmarkRemoteState: (bookmarkName: string) =>
      Effect.succeed({
        remoteBranchExists: pushedBranches.has(bookmarkName),
        needsBookmarkPush: !pushedBranches.has(bookmarkName)
      }),
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
    updatedPullRequests,
    updatedCommentPullRequests,
    describedBookmarks
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
      remoteBranchExists: true,
      needsBookmarkPush: false
    });
    expect(plan.stack[0]?.actions).not.toContainEqual(expect.stringContaining('create PR titled "feat/base"'));
    expect(plan.stack[1]).toMatchObject({
      intendedBaseBranch: "feat/base",
      remoteBranchExists: false,
      needsBookmarkPush: true
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
    expect(status.entries[0]?.needsBookmarkPush).toBe(false);
    expect(status.entries[1]?.pullRequest).toBeNull();
    expect(status.entries[1]?.remoteBranchExists).toBe(false);
    expect(status.entries[1]?.needsBookmarkPush).toBe(true);
  });

  it("supports an empty active stack without treating it as an error", async () => {
    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getCurrentStack: Effect.succeed([]),
      ensureBookmarkDescription: () => Effect.void,
      createBookmark: () => Effect.void,
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      refreshToRemoteBookmark: () => Effect.succeed(""),
      diffCurrentStack: () => Effect.die("diffCurrentStack should not be used in this test.")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestByHead: () => Effect.die("findPullRequestByHead should not be used for an empty stack."),
      createPullRequest: () => Effect.die("createPullRequest should not be used for an empty stack."),
      updatePullRequest: () => Effect.void,
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarkRemoteState: () => Effect.die("getBookmarkRemoteState should not be used for an empty stack."),
      pushBookmark: () => Effect.void
    });

    const processLayer = Layer.succeed(ProcessService, {
      run: () =>
        Effect.die("ProcessService should not be used when fake JJ/GitHub/Repo services are provided.")
    });

    const layer = Layer.mergeAll(jjLayer, repoLayer, gitLayer, githubLayer, processLayer, StackServiceLive);

    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.getStatus;
      }).pipe(Effect.provide(layer))
    );
    const plan = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.buildSyncPlan;
      }).pipe(Effect.provide(layer))
    );
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.executeSync;
      }).pipe(Effect.provide(layer))
    );

    expect(status.entries).toEqual([]);
    expect(plan.stack).toEqual([]);
    expect(result.statusEntries).toEqual([]);
    expect(result.createdPullRequestBookmarks).toEqual([]);
    expect(result.pushedBookmarks).toEqual([]);
    expect(result.warnings).toEqual([]);
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
    expect(result.updatedCommentPullRequestNumbers).toEqual([12, 13]);
    expect(result.warnings).toEqual([]);
    expect(result.statusEntries.every((entry) => entry.remoteBranchExists)).toBe(true);
    expect(result.statusEntries[1]?.pullRequest?.headRefName).toBe("feat/ui");
    expect(harness.describedBookmarks).toEqual([]);
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
    expect(result.updatedCommentPullRequestNumbers).toEqual([12, 13]);
    expect(result.warnings).toEqual([]);
    expect(result.statusEntries[1]?.pullRequest?.title).toBe("feat/ui");
    expect(result.statusEntries[1]?.pullRequest?.baseRefName).toBe("feat/base");
    expect(harness.describedBookmarks).toEqual([]);
  });

  it("fills blank jj change descriptions from bookmark names before pushing", async () => {
    const describedBookmarks: Array<string> = [];
    let currentStack: ReadonlyArray<StackEntry> = [
      {
        name: "feat/ui",
        changeId: "bbb222",
        commitId: "222bbb",
        description: "",
        parentBookmarkName: undefined,
        branchName: "feat/ui"
      }
    ];

    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getCurrentStack: Effect.sync(() => currentStack),
      ensureBookmarkDescription: (bookmarkName: string) =>
        Effect.sync(() => {
          describedBookmarks.push(bookmarkName);
          currentStack = currentStack.map((entry) =>
            entry.name === bookmarkName ? { ...entry, description: bookmarkName } : entry
          );
        }),
      createBookmark: () => Effect.void,
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      refreshToRemoteBookmark: () => Effect.succeed(""),
      diffCurrentStack: () => Effect.succeed("")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

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
    >();
    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestByHead: (branchName: string) => Effect.succeed(pullRequests.get(branchName) ?? null),
      createPullRequest: ({ headBranch, baseBranch, title }) =>
        Effect.sync(() => {
          const created = {
            number: 13,
            url: "https://github.com/MH15/jjacks/pull/13",
            title,
            headRefName: headBranch,
            baseRefName: baseBranch,
            isDraft: false
          };
          pullRequests.set(headBranch, created);
          return created;
        }),
      updatePullRequest: () => Effect.void,
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    let pushed = false;
    const gitLayer = Layer.succeed(GitService, {
      getBookmarkRemoteState: () =>
        Effect.succeed({
          remoteBranchExists: pushed,
          needsBookmarkPush: !pushed
        }),
      pushBookmark: () =>
        Effect.sync(() => {
          pushed = true;
        })
    });

    const processLayer = Layer.succeed(ProcessService, {
      run: () =>
        Effect.die("ProcessService should not be used when fake JJ/GitHub/Repo services are provided.")
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.executeSync;
      }).pipe(Effect.provide(Layer.mergeAll(jjLayer, repoLayer, gitLayer, githubLayer, processLayer, StackServiceLive)))
    );

    expect(describedBookmarks).toEqual(["feat/ui"]);
    expect(result.pushedBookmarks).toEqual(["feat/ui"]);
    expect(result.createdPullRequestBookmarks).toEqual(["feat/ui"]);
    expect(result.warnings).toEqual([]);
  });

  it("fails before PR creation when a bookmark still is not published after pushing", async () => {
    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getCurrentStack: Effect.succeed([
        {
          name: "feat/ui",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "feat/ui",
          parentBookmarkName: undefined,
          branchName: "feat/ui"
        }
      ] satisfies ReadonlyArray<StackEntry>),
      ensureBookmarkDescription: () => Effect.void,
      createBookmark: () => Effect.void,
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      refreshToRemoteBookmark: () => Effect.succeed(""),
      diffCurrentStack: () => Effect.succeed("")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestByHead: () => Effect.succeed(null),
      createPullRequest: () => Effect.die("createPullRequest should not run without a published remote branch."),
      updatePullRequest: () => Effect.void,
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarkRemoteState: () =>
        Effect.succeed({
          remoteBranchExists: false,
          needsBookmarkPush: true
        }),
      pushBookmark: () => Effect.void
    });

    const processLayer = Layer.succeed(ProcessService, {
      run: () =>
        Effect.die("ProcessService should not be used when fake JJ/GitHub/Repo services are provided.")
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.executeSync;
      }).pipe(Effect.provide(Layer.mergeAll(jjLayer, repoLayer, gitLayer, githubLayer, processLayer, StackServiceLive)))
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(CliError);
        expect(failure.value.message).toContain("still not published on origin after push");
      }
    }
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
        remoteBranchExists: true,
        needsBookmarkPush: false
      },
      {
        entry: stack[1]!,
        pullRequest: null,
        remoteBranchExists: false,
        needsBookmarkPush: true
      }
    ]);

    expect(comment).toContain(stackCommentMarker);
    expect(comment).toContain("[#12](https://github.com/MH15/jjacks/pull/12) `feat/base`");
    expect(comment).toContain("**current** `feat/ui` -> pending PR");
  });

  it("highlights the targeted pull request instead of always using the stack tip", () => {
    const comment = renderStackComment(
      [
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
          remoteBranchExists: true,
          needsBookmarkPush: false
        },
        {
          entry: stack[1]!,
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
      ],
      12
    );

    expect(comment).toContain("**current** [#12](https://github.com/MH15/jjacks/pull/12) `feat/base`");
    expect(comment).toContain("[#13](https://github.com/MH15/jjacks/pull/13) `feat/ui`");
    expect(comment).not.toContain("**current** [#13](https://github.com/MH15/jjacks/pull/13) `feat/ui`");
  });
});
