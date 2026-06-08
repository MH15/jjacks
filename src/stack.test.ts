import { describe, expect, it } from "vitest";
import { Cause, Effect, Layer } from "effect";

import type { RepoInfo, StackEntry, StackStatusEntry } from "../src/domain";
import { CliError } from "../src/errors";
import { analyzeReviewStack, buildSyncPlanFromStatus, renderStackComment, stackCommentMarker, upsertStackCommentInBody } from "../src/stack";
import { orderStackNodes, selectCurrentBookmarkTree } from "../src/services/JjService";
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
    branchName: "feat/base",
    isCurrent: false
  },
  {
    name: "feat/ui",
    changeId: "bbb222",
    commitId: "222bbb",
    description: "feat/ui",
    parentBookmarkName: "feat/base",
    branchName: "feat/ui",
    isCurrent: true
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
      body: string;
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
        isDraft: false,
        body: ""
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
      isDraft: false,
      body: ""
    });
  }
  const createdPullRequests: Array<string> = [];
  const updatedPullRequests: Array<number> = [];
  const issueComments = new Map([
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
    getStackCommentLocation: Effect.succeed("comment" as const),
    getCurrentStack: Effect.succeed(stack),
    getCurrentTree: Effect.succeed(stack),
    getTrackedBookmarks: Effect.succeed(stack),
    ensureBookmarkDescription: (bookmarkName: string) =>
      Effect.sync(() => {
        describedBookmarks.push(bookmarkName);
      }),
    createBookmark: () => Effect.void,
    moveToBookmark: () => Effect.succeed(""),
    moveUp: Effect.succeed(""),
    moveDown: Effect.succeed(""),
    syncBookmarkToRemote: () => Effect.void,
    editWorkingCopyOnStack: () => Effect.succeed(""),
    editWorkingCopyOnBookmark: () => Effect.succeed(""),
    logBookmarks: () => Effect.succeed(""),
    diffCurrentStack: () => Effect.succeed("")
  });

  const repoLayer = Layer.succeed(RepoService, {
    fetchOrigin: Effect.void,
    getRepoInfo: Effect.succeed(repoInfo)
  });

  const githubLayer = Layer.succeed(GitHubService, {
    findPullRequestsByHeads: (branchNames: ReadonlyArray<string>) =>
      Effect.succeed(new Map(branchNames.flatMap((branchName) => {
        const pullRequest = pullRequests.get(branchName);
        return pullRequest === undefined ? [] : [[branchName, pullRequest] as const];
      }))),
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
          isDraft: false,
          body: ""
        };
        pullRequests.set(headBranch, created);
        createdPullRequests.push(headBranch);
        return created;
      }),
    updatePullRequest: ({ number, baseBranch, title, body }) =>
      Effect.sync(() => {
        for (const [headBranch, pr] of pullRequests.entries()) {
          if (pr.number === number) {
            pullRequests.set(headBranch, {
              ...pr,
              baseRefName: baseBranch ?? pr.baseRefName,
              title: title ?? pr.title,
              body: body ?? pr.body
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
    getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) =>
      Effect.succeed(new Map(bookmarkNames.map((bookmarkName) => [
        bookmarkName,
        {
          remoteBranchExists: pushedBranches.has(bookmarkName),
          needsBookmarkPush: !pushedBranches.has(bookmarkName)
        }
      ]))),
    getBookmarkRemoteState: (bookmarkName: string) =>
      Effect.succeed({
        remoteBranchExists: pushedBranches.has(bookmarkName),
        needsBookmarkPush: !pushedBranches.has(bookmarkName)
      }),
    pushBookmarks: (bookmarkNames: ReadonlyArray<string>) =>
      Effect.sync(() => {
        for (const bookmarkName of bookmarkNames) {
          pushedBookmarks.push(bookmarkName);
          pushedBranches.add(bookmarkName);
        }
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

    expect(plan.githubActions).toHaveLength(2);
    expect(plan.githubActions[0]).toMatchObject({
      intendedBaseBranch: "main",
      remoteBranchExists: true,
      needsBookmarkPush: false
    });
    expect(plan.githubActions[0]?.actions).not.toContainEqual(expect.stringContaining("create PR"));
    expect(plan.githubActions[1]).toMatchObject({
      intendedBaseBranch: "feat/base",
      remoteBranchExists: false,
      needsBookmarkPush: true
    });
    expect(plan.githubActions[1]?.actions).toContain("push bookmark");
    expect(plan.githubActions[1]?.actions).toContain("create PR with base feat/base");
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
      getStackCommentLocation: Effect.succeed("comment" as const),
      getCurrentStack: Effect.succeed([]),
      getCurrentTree: Effect.succeed([]),
      getTrackedBookmarks: Effect.succeed([]),
      ensureBookmarkDescription: () => Effect.void,
      createBookmark: () => Effect.void,
      moveToBookmark: () => Effect.succeed(""),
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      syncBookmarkToRemote: () => Effect.void,
      editWorkingCopyOnStack: () => Effect.succeed(""),
      editWorkingCopyOnBookmark: () => Effect.succeed(""),
      logBookmarks: () => Effect.die("logBookmarks should not be used in this test."),
      diffCurrentStack: () => Effect.die("diffCurrentStack should not be used in this test.")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestsByHeads: () => Effect.die("findPullRequestsByHeads should not be used for an empty stack."),
      findPullRequestByHead: () => Effect.die("findPullRequestByHead should not be used for an empty stack."),
      createPullRequest: () => Effect.die("createPullRequest should not be used for an empty stack."),
      updatePullRequest: () => Effect.void,
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarksRemoteState: () => Effect.die("getBookmarksRemoteState should not be used for an empty stack."),
      getBookmarkRemoteState: () => Effect.die("getBookmarkRemoteState should not be used for an empty stack."),
      pushBookmarks: () => Effect.void,
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
    expect(plan.githubActions).toEqual([]);
    expect(result.statusEntries).toEqual([]);
    expect(result.createdPullRequestBookmarks).toEqual([]);
    expect(result.pushedBookmarks).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("ignores repo-tracked bookmarks when the current working copy is just an empty trunk continuation", async () => {
    const trackedBookmarks: ReadonlyArray<StackEntry> = [
      {
        name: "feat/elsewhere",
        changeId: "bbb222",
        commitId: "222bbb",
        description: "feat/elsewhere",
        parentBookmarkName: undefined,
        branchName: "feat/elsewhere",
        isCurrent: false
      }
    ];

    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getStackCommentLocation: Effect.succeed("comment" as const),
      getCurrentStack: Effect.succeed([]),
      getCurrentTree: Effect.succeed([]),
      getTrackedBookmarks: Effect.succeed(trackedBookmarks),
      ensureBookmarkDescription: () => Effect.void,
      createBookmark: () => Effect.void,
      moveToBookmark: () => Effect.succeed(""),
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      syncBookmarkToRemote: () => Effect.void,
      editWorkingCopyOnStack: () => Effect.succeed(""),
      editWorkingCopyOnBookmark: () => Effect.succeed(""),
      logBookmarks: () => Effect.die("logBookmarks should not be used in this test."),
      diffCurrentStack: () => Effect.die("diffCurrentStack should not be used in this test.")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestsByHeads: () => Effect.die("findPullRequestsByHeads should not be used without an active stack."),
      findPullRequestByHead: () => Effect.die("findPullRequestByHead should not be used without an active stack."),
      createPullRequest: () => Effect.die("createPullRequest should not be used without an active stack."),
      updatePullRequest: () => Effect.void,
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarksRemoteState: () => Effect.die("getBookmarksRemoteState should not be used without an active stack."),
      getBookmarkRemoteState: () => Effect.die("getBookmarkRemoteState should not be used without an active stack."),
      pushBookmarks: () => Effect.void,
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
    expect(plan.githubActions).toEqual([]);
    expect(result.statusEntries).toEqual([]);
    expect(result.createdPullRequestBookmarks).toEqual([]);
    expect(result.pushedBookmarks).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("moves back to a trunk continuation and skips GitHub work when only merged entries remain", async () => {
    const currentStack: ReadonlyArray<StackEntry> = [
      {
        name: "fix/merged-parent-retarget",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "fix/merged-parent-retarget",
        parentBookmarkName: undefined,
        branchName: "fix/merged-parent-retarget",
        isCurrent: true
      }
    ];
    const editedBookmarks: Array<string> = [];

    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getStackCommentLocation: Effect.succeed("comment" as const),
      getCurrentStack: Effect.succeed(currentStack),
      getCurrentTree: Effect.succeed(currentStack),
      getTrackedBookmarks: Effect.succeed(currentStack),
      ensureBookmarkDescription: () => Effect.die("ensureBookmarkDescription should not run for a completed stack."),
      createBookmark: () => Effect.void,
      moveToBookmark: () => Effect.succeed(""),
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      syncBookmarkToRemote: () => Effect.void,
      editWorkingCopyOnStack: () => Effect.die("editWorkingCopyOnStack should not run for a completed stack."),
      editWorkingCopyOnBookmark: ({ bookmarkName }) =>
        Effect.sync(() => {
          editedBookmarks.push(bookmarkName);
          return "";
        }),
      logBookmarks: () => Effect.die("logBookmarks should not be used in this test."),
      diffCurrentStack: () => Effect.succeed("")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestsByHeads: () =>
        Effect.succeed(
          new Map([
            [
              "fix/merged-parent-retarget",
              {
                number: 58,
                url: "https://github.com/MH15/jjacks/pull/58",
                title: "fix/merged-parent-retarget",
                headRefName: "fix/merged-parent-retarget",
                baseRefName: "main",
                state: "MERGED",
                isDraft: false,
                body: ""
              }
            ]
          ])
        ),
      findPullRequestByHead: () => Effect.die("findPullRequestByHead should not run in batch mode."),
      createPullRequest: () => Effect.die("createPullRequest should not run for a completed stack."),
      updatePullRequest: () => Effect.die("updatePullRequest should not run for a completed stack."),
      listIssueComments: () => Effect.die("listIssueComments should not run for a completed stack."),
      createIssueComment: () => Effect.die("createIssueComment should not run for a completed stack."),
      updateIssueComment: () => Effect.die("updateIssueComment should not run for a completed stack.")
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) =>
        Effect.succeed(new Map(bookmarkNames.map((bookmarkName) => [
          bookmarkName,
          {
            remoteBranchExists: true,
            needsBookmarkPush: false
          }
        ]))),
      getBookmarkRemoteState: () => Effect.die("getBookmarkRemoteState should not run in batch mode."),
      pushBookmarks: () => Effect.die("pushBookmarks should not run for a completed stack."),
      pushBookmark: () => Effect.die("pushBookmark should not run for a completed stack.")
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

    expect(editedBookmarks).toEqual(["main"]);
    expect(result.plan.completionState).toBe("stack-complete");
    expect(result.plan.githubActions).toEqual([]);
    expect(result.createdPullRequestBookmarks).toEqual([]);
    expect(result.updatedPullRequestNumbers).toEqual([]);
    expect(result.updatedCommentPullRequestNumbers).toEqual([]);
  });

  it("rebases and retargets a child whose merged parent was pruned from the effective stack", async () => {
    const currentStack: ReadonlyArray<StackEntry> = [
      {
        name: "remove-refresh",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "remove-refresh",
        parentBookmarkName: undefined,
        branchName: "remove-refresh",
        isCurrent: false
      },
      {
        name: "fix/create-next-copy",
        changeId: "bbb222",
        commitId: "222bbb",
        description: "fix/create-next-copy",
        parentBookmarkName: "remove-refresh",
        branchName: "fix/create-next-copy",
        isCurrent: true
      }
    ];
    const editStackCalls: Array<{
      readonly rootBookmarkName: string;
      readonly currentBookmarkName: string;
      readonly defaultBranch: string;
    }> = [];
    const updatedBases: Array<string> = [];

    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getStackCommentLocation: Effect.succeed("comment" as const),
      getCurrentStack: Effect.succeed(currentStack),
      getCurrentTree: Effect.succeed(currentStack),
      getTrackedBookmarks: Effect.succeed(currentStack),
      ensureBookmarkDescription: () => Effect.void,
      createBookmark: () => Effect.void,
      moveToBookmark: () => Effect.succeed(""),
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      syncBookmarkToRemote: () => Effect.void,
      editWorkingCopyOnStack: ({ rootBookmarkName, currentBookmarkName, defaultBranch }) =>
        Effect.sync(() => {
          editStackCalls.push({ rootBookmarkName, currentBookmarkName, defaultBranch });
          return "";
        }),
      editWorkingCopyOnBookmark: () => Effect.die("editWorkingCopyOnBookmark should not run with an active child."),
      logBookmarks: () => Effect.die("logBookmarks should not be used in this test."),
      diffCurrentStack: () => Effect.succeed("")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestsByHeads: () =>
        Effect.succeed(
          new Map([
            [
              "remove-refresh",
              {
                number: 56,
                url: "https://github.com/MH15/jjacks/pull/56",
                title: "remove-refresh",
                headRefName: "remove-refresh",
                baseRefName: "main",
                state: "MERGED",
                isDraft: false,
                body: ""
              }
            ],
            [
              "fix/create-next-copy",
              {
                number: 57,
                url: "https://github.com/MH15/jjacks/pull/57",
                title: "fix/create-next-copy",
                headRefName: "fix/create-next-copy",
                baseRefName: "remove-refresh",
                state: "OPEN",
                isDraft: false,
                body: ""
              }
            ]
          ])
        ),
      findPullRequestByHead: () => Effect.die("findPullRequestByHead should not run in batch mode."),
      createPullRequest: () => Effect.die("createPullRequest should not run for an existing PR."),
      updatePullRequest: ({ baseBranch }) =>
        Effect.sync(() => {
          if (baseBranch !== undefined) {
            updatedBases.push(baseBranch);
          }
        }),
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) =>
        Effect.succeed(new Map(bookmarkNames.map((bookmarkName) => [
          bookmarkName,
          {
            remoteBranchExists: true,
            needsBookmarkPush: false
          }
        ]))),
      getBookmarkRemoteState: () => Effect.die("getBookmarkRemoteState should not run in batch mode."),
      pushBookmarks: () => Effect.void,
      pushBookmark: () => Effect.void
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

    expect(editStackCalls).toEqual([
      {
        rootBookmarkName: "fix/create-next-copy",
        currentBookmarkName: "fix/create-next-copy",
        defaultBranch: "main"
      }
    ]);
    expect(updatedBases).toEqual(["main"]);
    expect(result.plan.githubActions).toHaveLength(1);
    expect(result.plan.githubActions[0]?.intendedBaseBranch).toBe("main");
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

  it("reuses prepared status when refreshing the interactive sync path", async () => {
    const events: Array<string> = [];
    const preparedEntries: ReadonlyArray<StackStatusEntry> = [
      {
        entry: stack[0]!,
        pullRequest: {
          number: 12,
          url: "https://github.com/MH15/jjacks/pull/12",
          title: "feat/base",
          headRefName: "feat/base",
          baseRefName: "main",
          state: "OPEN",
          isDraft: false,
          body: ""
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
    ];

    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getStackCommentLocation: Effect.succeed("comment" as const),
      getCurrentStack: Effect.succeed(stack),
      getCurrentTree: Effect.sync(() => {
        events.push("status");
        return stack;
      }),
      getTrackedBookmarks: Effect.succeed(stack),
      ensureBookmarkDescription: () => Effect.void,
      createBookmark: () => Effect.void,
      moveToBookmark: () => Effect.succeed(""),
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      syncBookmarkToRemote: () =>
        Effect.sync(() => {
          events.push("move-main");
        }),
      editWorkingCopyOnStack: () =>
        Effect.sync(() => {
          events.push("edit-stack");
          return "";
        }),
      editWorkingCopyOnBookmark: () => Effect.succeed(""),
      logBookmarks: () => Effect.succeed(""),
      diffCurrentStack: () => Effect.succeed("")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.sync(() => {
        events.push("fetch");
      }),
      getRepoInfo: Effect.die("repo info should come from prepared sync state.")
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestsByHeads: () => Effect.succeed(new Map([["feat/base", preparedEntries[0]!.pullRequest!]])),
      findPullRequestByHead: () => Effect.succeed(null),
      createPullRequest: () => Effect.die("createPullRequest should not run during local refresh."),
      updatePullRequest: () => Effect.void,
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) =>
        Effect.succeed(new Map(bookmarkNames.map((bookmarkName) => [
          bookmarkName,
          {
            remoteBranchExists: bookmarkName === "feat/base",
            needsBookmarkPush: bookmarkName !== "feat/base"
          }
        ]))),
      getBookmarkRemoteState: () =>
        Effect.succeed({
          remoteBranchExists: true,
          needsBookmarkPush: false
        }),
      pushBookmarks: () => Effect.void,
      pushBookmark: () => Effect.void
    });

    const processLayer = Layer.succeed(ProcessService, {
      run: () =>
        Effect.die("ProcessService should not be used when fake JJ/GitHub/Repo services are provided.")
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.refreshLocalStackFromPrepared({
          defaultBranch: "main",
          entries: preparedEntries,
          preparedAtMs: Date.now()
        });
      }).pipe(Effect.provide(Layer.mergeAll(jjLayer, repoLayer, gitLayer, githubLayer, processLayer, StackServiceLive)))
    );

    expect(events[0]).toBe("fetch");
    expect(events).toEqual(["fetch", "move-main", "status", "edit-stack", "status"]);
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
        branchName: "feat/ui",
        isCurrent: true
      }
    ];

    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getStackCommentLocation: Effect.succeed("comment" as const),
      getCurrentStack: Effect.sync(() => currentStack),
      getCurrentTree: Effect.sync(() => currentStack),
      getTrackedBookmarks: Effect.sync(() => currentStack),
      ensureBookmarkDescription: (bookmarkName: string) =>
        Effect.sync(() => {
          describedBookmarks.push(bookmarkName);
          currentStack = currentStack.map((entry) =>
            entry.name === bookmarkName ? { ...entry, description: bookmarkName } : entry
          );
      }),
      createBookmark: () => Effect.void,
      moveToBookmark: () => Effect.succeed(""),
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      syncBookmarkToRemote: () => Effect.void,
      editWorkingCopyOnStack: () => Effect.succeed(""),
      editWorkingCopyOnBookmark: () => Effect.succeed(""),
      logBookmarks: () => Effect.succeed(""),
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
        body: string;
      }
    >();
    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestsByHeads: (branchNames: ReadonlyArray<string>) =>
        Effect.succeed(new Map(branchNames.flatMap((branchName) => {
          const pullRequest = pullRequests.get(branchName);
          return pullRequest === undefined ? [] : [[branchName, pullRequest] as const];
        }))),
      findPullRequestByHead: (branchName: string) => Effect.succeed(pullRequests.get(branchName) ?? null),
      createPullRequest: ({ headBranch, baseBranch, title }) =>
        Effect.sync(() => {
          const created = {
            number: 13,
            url: "https://github.com/MH15/jjacks/pull/13",
          title,
          headRefName: headBranch,
          baseRefName: baseBranch,
          isDraft: false,
          body: ""
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
      getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) =>
        Effect.succeed(new Map(bookmarkNames.map((bookmarkName) => [
          bookmarkName,
          {
            remoteBranchExists: pushed,
            needsBookmarkPush: !pushed
          }
        ]))),
      getBookmarkRemoteState: () =>
        Effect.succeed({
          remoteBranchExists: pushed,
          needsBookmarkPush: !pushed
        }),
      pushBookmarks: () =>
        Effect.sync(() => {
          pushed = true;
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
      getStackCommentLocation: Effect.succeed("comment" as const),
      getCurrentStack: Effect.succeed([
        {
          name: "feat/ui",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "feat/ui",
          parentBookmarkName: undefined,
          branchName: "feat/ui",
          isCurrent: true
        }
      ] satisfies ReadonlyArray<StackEntry>),
      getCurrentTree: Effect.succeed([
        {
          name: "feat/ui",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "feat/ui",
          parentBookmarkName: undefined,
          branchName: "feat/ui",
          isCurrent: true
        }
      ] satisfies ReadonlyArray<StackEntry>),
      getTrackedBookmarks: Effect.succeed([
        {
          name: "feat/ui",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "feat/ui",
          parentBookmarkName: undefined,
          branchName: "feat/ui",
          isCurrent: true
        }
      ] satisfies ReadonlyArray<StackEntry>),
      ensureBookmarkDescription: () => Effect.void,
      createBookmark: () => Effect.void,
      moveToBookmark: () => Effect.succeed(""),
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      syncBookmarkToRemote: () => Effect.void,
      editWorkingCopyOnStack: () => Effect.succeed(""),
      editWorkingCopyOnBookmark: () => Effect.succeed(""),
      logBookmarks: () => Effect.succeed(""),
      diffCurrentStack: () => Effect.succeed("")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestsByHeads: () => Effect.succeed(new Map()),
      findPullRequestByHead: () => Effect.succeed(null),
      createPullRequest: () => Effect.die("createPullRequest should not run without a published remote branch."),
      updatePullRequest: () => Effect.void,
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) =>
        Effect.succeed(new Map(bookmarkNames.map((bookmarkName) => [
          bookmarkName,
          {
            remoteBranchExists: false,
            needsBookmarkPush: true
          }
        ]))),
      getBookmarkRemoteState: () =>
        Effect.succeed({
          remoteBranchExists: false,
          needsBookmarkPush: true
        }),
      pushBookmarks: () => Effect.void,
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

  it("skips empty parent bookmarks without PRs and syncs their real children against the nearest syncable base", async () => {
    const emptyParentStack: ReadonlyArray<StackEntry> = [
      {
        name: "mh/cleanup-refresh-message",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "mh/cleanup-refresh-message",
        parentBookmarkName: undefined,
        branchName: "mh/cleanup-refresh-message",
        isCurrent: false,
        isEmpty: true
      },
      {
        name: "mh/optimize",
        changeId: "bbb222",
        commitId: "222bbb",
        description: "mh/optimize",
        parentBookmarkName: "mh/cleanup-refresh-message",
        branchName: "mh/optimize",
        isCurrent: true
      }
    ];

    const pushedBranches = new Set<string>();
    const createdPullRequests: Array<string> = [];
    const jjLayer = Layer.succeed(JjService, {
      ensureAdvanceBookmarksEnabled: Effect.void,
      getStackCommentLocation: Effect.succeed("comment" as const),
      getCurrentStack: Effect.succeed(emptyParentStack),
      getCurrentTree: Effect.succeed(emptyParentStack),
      getTrackedBookmarks: Effect.succeed(emptyParentStack),
      ensureBookmarkDescription: () => Effect.void,
      createBookmark: () => Effect.void,
      moveToBookmark: () => Effect.succeed(""),
      moveUp: Effect.succeed(""),
      moveDown: Effect.succeed(""),
      syncBookmarkToRemote: () => Effect.void,
      editWorkingCopyOnStack: () => Effect.succeed(""),
      editWorkingCopyOnBookmark: () => Effect.succeed(""),
      logBookmarks: () => Effect.succeed(""),
      diffCurrentStack: () => Effect.succeed("")
    });

    const repoLayer = Layer.succeed(RepoService, {
      fetchOrigin: Effect.void,
      getRepoInfo: Effect.succeed(repoInfo)
    });

    const githubLayer = Layer.succeed(GitHubService, {
      findPullRequestsByHeads: () => Effect.succeed(new Map()),
      findPullRequestByHead: () => Effect.succeed(null),
      createPullRequest: ({ headBranch, baseBranch, title }) =>
        Effect.sync(() => {
          createdPullRequests.push(`${headBranch}:${baseBranch}:${title}`);
          return {
            number: 99,
            url: "https://github.com/MH15/jjacks/pull/99",
            title,
            headRefName: headBranch,
            baseRefName: baseBranch,
            isDraft: false,
            body: ""
          };
        }),
      updatePullRequest: () => Effect.void,
      listIssueComments: () => Effect.succeed([]),
      createIssueComment: () => Effect.void,
      updateIssueComment: () => Effect.void
    });

    const gitLayer = Layer.succeed(GitService, {
      getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) =>
        Effect.succeed(new Map(bookmarkNames.map((bookmarkName) => [
          bookmarkName,
          {
            remoteBranchExists: pushedBranches.has(bookmarkName),
            needsBookmarkPush: !pushedBranches.has(bookmarkName)
          }
        ]))),
      getBookmarkRemoteState: (bookmarkName: string) =>
        Effect.succeed({
          remoteBranchExists: pushedBranches.has(bookmarkName),
          needsBookmarkPush: !pushedBranches.has(bookmarkName)
        }),
      pushBookmarks: (bookmarkNames: ReadonlyArray<string>) =>
        Effect.sync(() => {
          for (const bookmarkName of bookmarkNames) {
            pushedBranches.add(bookmarkName);
          }
        }),
      pushBookmark: (bookmarkName: string) =>
        Effect.sync(() => {
          pushedBranches.add(bookmarkName);
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

    expect(result.plan.githubActions).toHaveLength(1);
    expect(result.plan.githubActions[0]?.entry.name).toBe("mh/optimize");
    expect(result.plan.githubActions[0]?.intendedBaseBranch).toBe("main");
    expect(result.pushedBookmarks).toEqual(["mh/optimize"]);
    expect(result.createdPullRequestBookmarks).toEqual(["mh/optimize"]);
    expect(createdPullRequests).toEqual(["mh/optimize:main:mh/optimize"]);
  });
});

describe("buildSyncPlanFromStatus", () => {
  it("classifies closed PRs as pruned and retargets their children to main", () => {
    const plan = buildSyncPlanFromStatus(
      [
        {
          entry: {
            name: "feat/abandoned",
            changeId: "aaa111",
            commitId: "111aaa",
            description: "feat/abandoned",
            parentBookmarkName: undefined,
            branchName: "feat/abandoned",
            isCurrent: false
          },
          pullRequest: {
            number: 31,
            url: "https://github.com/MH15/jjacks/pull/31",
            title: "feat/abandoned",
            headRefName: "feat/abandoned",
            baseRefName: "main",
            state: "CLOSED",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        },
        {
          entry: {
            name: "feat/survivor",
            changeId: "bbb222",
            commitId: "222bbb",
            description: "feat/survivor",
            parentBookmarkName: "feat/abandoned",
            branchName: "feat/survivor",
            isCurrent: true
          },
          pullRequest: {
            number: 32,
            url: "https://github.com/MH15/jjacks/pull/32",
            title: "feat/survivor",
            headRefName: "feat/survivor",
            baseRefName: "feat/abandoned",
            state: "OPEN",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        }
      ],
      "main"
    );

    expect(plan.closedEntries[0]?.actions).toContain("PR #31 is closed; removed from active stack");
    expect(plan.githubActions).toHaveLength(1);
    expect(plan.githubActions[0]?.intendedBaseBranch).toBe("main");
    expect(plan.githubActions[0]?.actions).toContain("retarget PR #32 base from feat/abandoned to main");
  });

  it("keeps a clean sibling syncable when a conflicted sibling subtree is blocked", () => {
    const analysis = analyzeReviewStack(
      [
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
            number: 40,
            url: "https://github.com/MH15/jjacks/pull/40",
            title: "feat/base",
            headRefName: "feat/base",
            baseRefName: "main",
            state: "OPEN",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        },
        {
          entry: {
            name: "feat/conflict",
            changeId: "bbb222",
            commitId: "222bbb",
            description: "feat/conflict",
            parentBookmarkName: "feat/base",
            branchName: "feat/conflict",
            isCurrent: false,
            hasConflict: true
          },
          pullRequest: null,
          remoteBranchExists: false,
          needsBookmarkPush: true,
          blockedBy: "feat/conflict"
        },
        {
          entry: {
            name: "feat/child",
            changeId: "ccc333",
            commitId: "333ccc",
            description: "feat/child",
            parentBookmarkName: "feat/conflict",
            branchName: "feat/child",
            isCurrent: false
          },
          pullRequest: null,
          remoteBranchExists: false,
          needsBookmarkPush: true,
          blockedBy: "feat/conflict"
        },
        {
          entry: {
            name: "feat/clean",
            changeId: "ddd444",
            commitId: "444ddd",
            description: "feat/clean",
            parentBookmarkName: "feat/base",
            branchName: "feat/clean",
            isCurrent: true
          },
          pullRequest: null,
          remoteBranchExists: false,
          needsBookmarkPush: true
        }
      ],
      "main"
    );

    expect(analysis.blockedEntries.map((entry) => entry.entry.name)).toEqual(["feat/conflict", "feat/child"]);
    expect(analysis.syncableEntries.map((entry) => entry.entry.name)).toEqual(["feat/base", "feat/clean"]);
    expect(analysis.currentSyncableEntry?.entry.name).toBe("feat/clean");
  });

  it("retargets the surviving bottom PR to main after a merged lower layer disappears", () => {
    const plan = buildSyncPlanFromStatus(
      [
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
      ],
      "main"
    );

    expect(plan.localActions).toEqual([
      "fetch origin",
      "move main to main@origin",
      "rebase mh/inquirer onto main",
      "edit mh/ancestors"
    ]);
    expect(plan.githubActions[0]?.intendedBaseBranch).toBe("main");
    expect(plan.githubActions[0]?.actions).toContain("retarget PR #17 base from mh/refrehs-fixes to main");
    expect(plan.githubActions[1]?.intendedBaseBranch).toBe("mh/inquirer");
    expect(plan.githubActions[1]?.actions).not.toContain(expect.stringContaining("retarget PR #18"));
  });

  it("blocks a conflicted subtree from GitHub actions", () => {
    const plan = buildSyncPlanFromStatus(
      [
        {
          entry: {
            name: "feat/base",
            changeId: "aaa111",
            commitId: "111aaa",
            description: "feat/base",
            parentBookmarkName: undefined,
            branchName: "feat/base",
            isCurrent: false,
            hasConflict: true
          },
          pullRequest: {
            number: 12,
            url: "https://github.com/MH15/jjacks/pull/12",
            title: "feat/base",
            headRefName: "feat/base",
            baseRefName: "old-base",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: true,
          blockedBy: "feat/base"
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
          pullRequest: null,
          remoteBranchExists: false,
          needsBookmarkPush: true,
          blockedBy: "feat/base"
        }
      ],
      "main"
    );

    expect(plan.githubActions).toEqual([]);
    expect(plan.blockedEntries[0]?.actions).toContain("blocked by local conflict; resolve before syncing this subtree");
    expect(plan.blockedEntries[0]?.actions).not.toContain("push bookmark");
    expect(plan.blockedEntries[0]?.actions).not.toContain(expect.stringContaining("retarget PR #12"));
    expect(plan.blockedEntries[1]?.actions).toContain("blocked by local conflict in feat/base; resolve parent before syncing this subtree");
    expect(plan.blockedEntries[1]?.actions).not.toContain("push bookmark");
    expect(plan.blockedEntries[1]?.actions).not.toContain(expect.stringContaining("create PR"));
  });

  it("does not recreate or mutate merged pull requests", () => {
    const plan = buildSyncPlanFromStatus(
      [
        {
          entry: {
            name: "mh/open-questions",
            changeId: "aaa111",
            commitId: "111aaa",
            description: "mh/open-questions",
            parentBookmarkName: undefined,
            branchName: "mh/open-questions",
            isCurrent: false
          },
          pullRequest: {
            number: 55,
            url: "https://github.com/MH15/jjacks/pull/55",
            title: "mh/open-questions",
            headRefName: "mh/open-questions",
            baseRefName: "old-main",
            state: "MERGED",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: true
        }
      ],
      "main"
    );

    expect(plan.completionState).toBe("stack-complete");
    expect(plan.githubActions).toEqual([]);
    expect(plan.landedEntries[0]?.actions).toContain("PR #55 is merged; removed from active stack");
    expect(plan.landedEntries[0]?.actions).not.toContain("push bookmark");
    expect(plan.landedEntries[0]?.actions).not.toContain(expect.stringContaining("create PR"));
    expect(plan.landedEntries[0]?.actions).not.toContain(expect.stringContaining("retarget PR #55"));
  });

  it("retargets children of merged PRs to the nearest syncable base", () => {
    const plan = buildSyncPlanFromStatus(
      [
        {
          entry: {
            name: "remove-refresh",
            changeId: "aaa111",
            commitId: "111aaa",
            description: "remove-refresh",
            parentBookmarkName: undefined,
            branchName: "remove-refresh",
            isCurrent: false
          },
          pullRequest: {
            number: 56,
            url: "https://github.com/MH15/jjacks/pull/56",
            title: "remove-refresh",
            headRefName: "remove-refresh",
            baseRefName: "mh/open-questions",
            state: "MERGED",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        },
        {
          entry: {
            name: "fix/create-next-copy",
            changeId: "bbb222",
            commitId: "222bbb",
            description: "fix/create-next-copy",
            parentBookmarkName: "remove-refresh",
            branchName: "fix/create-next-copy",
            isCurrent: true
          },
          pullRequest: {
            number: 57,
            url: "https://github.com/MH15/jjacks/pull/57",
            title: "fix/create-next-copy",
            headRefName: "fix/create-next-copy",
            baseRefName: "remove-refresh",
            state: "OPEN",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        }
      ],
      "main"
    );

    expect(plan.localActions).toEqual([
      "fetch origin",
      "move main to main@origin",
      "rebase fix/create-next-copy onto main",
      "edit fix/create-next-copy"
    ]);
    expect(plan.githubActions).toHaveLength(1);
    expect(plan.githubActions[0]?.intendedBaseBranch).toBe("main");
    expect(plan.githubActions[0]?.actions).toContain("retarget PR #57 base from remove-refresh to main");
  });

  it("keeps sibling branches based on their shared bookmarked parent instead of chaining them together", () => {
    const plan = buildSyncPlanFromStatus(
      [
        {
          entry: {
            name: "mh/base",
            changeId: "aaa111",
            commitId: "111aaa",
            description: "mh/base",
            parentBookmarkName: undefined,
            branchName: "mh/base",
            isCurrent: false
          },
          pullRequest: {
            number: 28,
            url: "https://github.com/MH15/jjacks/pull/28",
            title: "mh/base",
            headRefName: "mh/base",
            baseRefName: "main",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        },
        {
          entry: {
            name: "mh/alias",
            changeId: "bbb222",
            commitId: "222bbb",
            description: "mh/alias",
            parentBookmarkName: "mh/base",
            branchName: "mh/alias",
            isCurrent: false
          },
          pullRequest: {
            number: 29,
            url: "https://github.com/MH15/jjacks/pull/29",
            title: "mh/alias",
            headRefName: "mh/alias",
            baseRefName: "mh/base",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        },
        {
          entry: {
            name: "mh/timing",
            changeId: "ccc333",
            commitId: "333ccc",
            description: "mh/timing",
            parentBookmarkName: "mh/base",
            branchName: "mh/timing",
            isCurrent: true
          },
          pullRequest: {
            number: 30,
            url: "https://github.com/MH15/jjacks/pull/30",
            title: "mh/timing",
            headRefName: "mh/timing",
            baseRefName: "mh/base",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        }
      ],
      "main"
    );

    expect(plan.githubActions[1]?.intendedBaseBranch).toBe("mh/base");
    expect(plan.githubActions[2]?.intendedBaseBranch).toBe("mh/base");
    expect(plan.githubActions[2]?.actions).not.toContain(expect.stringContaining("retarget PR #30 base from mh/base to mh/alias"));
  });
});

describe("orderStackNodes", () => {
  it("extends the current ancestor path with bookmarked children above the current bookmark", () => {
    const allNodes = [
      {
        name: "feat/base",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "feat/base",
        parentBookmarkName: undefined
      },
      {
        name: "feat/ui",
        changeId: "bbb222",
        commitId: "222bbb",
        description: "feat/ui",
        parentBookmarkName: "feat/base"
      }
    ];

    const ordered = orderStackNodes(allNodes, [allNodes[0]!]);

    expect(ordered.map((node) => node.name)).toEqual(["feat/base", "feat/ui"]);
  });

  it("preserves the full linear stack when already positioned at the tip", () => {
    const allNodes = [
      {
        name: "feat/base",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "feat/base",
        parentBookmarkName: undefined
      },
      {
        name: "feat/ui",
        changeId: "bbb222",
        commitId: "222bbb",
        description: "feat/ui",
        parentBookmarkName: "feat/base"
      }
    ];

    const ordered = orderStackNodes(allNodes, allNodes);

    expect(ordered.map((node) => node.name)).toEqual(["feat/base", "feat/ui"]);
  });

  it("stops extending when the child chain is ambiguous", () => {
    const allNodes = [
      {
        name: "feat/base",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "feat/base",
        parentBookmarkName: undefined
      },
      {
        name: "feat/ui",
        changeId: "bbb222",
        commitId: "222bbb",
        description: "feat/ui",
        parentBookmarkName: "feat/base"
      },
      {
        name: "feat/alt",
        changeId: "ccc333",
        commitId: "333ccc",
        description: "feat/alt",
        parentBookmarkName: "feat/base"
      }
    ];

    const ordered = orderStackNodes(allNodes, [allNodes[0]!]);

    expect(ordered.map((node) => node.name)).toEqual(["feat/base"]);
  });
});

describe("selectCurrentBookmarkTree", () => {
  it("keeps sibling branches in the current tree rooted at the current bookmark's top ancestor", () => {
    const entries: ReadonlyArray<StackEntry> = [
      {
        name: "feat/base",
        changeId: "aaa111",
        commitId: "111aaa",
        description: "feat/base",
        parentBookmarkName: undefined,
        branchName: "feat/base",
        isCurrent: false
      },
      {
        name: "feat/right",
        changeId: "bbb222",
        commitId: "222bbb",
        description: "feat/right",
        parentBookmarkName: "feat/base",
        branchName: "feat/right",
        isCurrent: true
      },
      {
        name: "feat/left",
        changeId: "ccc333",
        commitId: "333ccc",
        description: "feat/left",
        parentBookmarkName: "feat/base",
        branchName: "feat/left",
        isCurrent: false
      },
      {
        name: "other/root",
        changeId: "ddd444",
        commitId: "444ddd",
        description: "other/root",
        parentBookmarkName: undefined,
        branchName: "other/root",
        isCurrent: false
      }
    ];

    const selected = selectCurrentBookmarkTree(entries, "feat/right");

    expect(selected.map((entry) => entry.name)).toEqual(["feat/base", "feat/right", "feat/left"]);
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
          isDraft: false,
          body: ""
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
            isDraft: false,
            body: ""
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
            isDraft: false,
            body: ""
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

  it("uses the actual current bookmark for preview comments when positioned mid-stack", () => {
    const comment = renderStackComment(
      [
        {
          entry: {
            ...stack[0]!,
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
            ...stack[1]!,
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
        },
        {
          entry: {
            name: "feat/api",
            changeId: "ccc333",
            commitId: "333ccc",
            description: "feat/api",
            parentBookmarkName: "feat/ui",
            branchName: "feat/api",
            isCurrent: false
          },
          pullRequest: {
            number: 14,
            url: "https://github.com/MH15/jjacks/pull/14",
            title: "feat/api",
            headRefName: "feat/api",
            baseRefName: "feat/ui",
            isDraft: false,
            body: ""
          },
          remoteBranchExists: true,
          needsBookmarkPush: false
        }
      ]
    );

    expect(comment).toContain("[#12](https://github.com/MH15/jjacks/pull/12) `feat/base`");
    expect(comment).toContain("**current** [#13](https://github.com/MH15/jjacks/pull/13) `feat/ui`");
    expect(comment).not.toContain("**current** [#14](https://github.com/MH15/jjacks/pull/14) `feat/api`");
  });

  it("renders sibling branches as nested entries under their shared parent", () => {
    const comment = renderStackComment([
      {
        entry: {
          name: "mh/base",
          changeId: "aaa111",
          commitId: "111aaa",
          description: "mh/base",
          parentBookmarkName: undefined,
          branchName: "mh/base",
          isCurrent: false
        },
        pullRequest: {
          number: 28,
          url: "https://github.com/MH15/jjacks/pull/28",
          title: "mh/base",
          headRefName: "mh/base",
          baseRefName: "main",
          isDraft: false,
          body: ""
        },
        remoteBranchExists: true,
        needsBookmarkPush: false
      },
      {
        entry: {
          name: "mh/alias",
          changeId: "bbb222",
          commitId: "222bbb",
          description: "mh/alias",
          parentBookmarkName: "mh/base",
          branchName: "mh/alias",
          isCurrent: false
        },
        pullRequest: {
          number: 29,
          url: "https://github.com/MH15/jjacks/pull/29",
          title: "mh/alias",
          headRefName: "mh/alias",
          baseRefName: "mh/base",
          isDraft: false,
          body: ""
        },
        remoteBranchExists: true,
        needsBookmarkPush: false
      },
      {
        entry: {
          name: "mh/timing",
          changeId: "ccc333",
          commitId: "333ccc",
          description: "mh/timing",
          parentBookmarkName: "mh/base",
          branchName: "mh/timing",
          isCurrent: true
        },
        pullRequest: {
          number: 30,
          url: "https://github.com/MH15/jjacks/pull/30",
          title: "mh/timing",
          headRefName: "mh/timing",
          baseRefName: "mh/base",
          isDraft: false,
          body: ""
        },
        remoteBranchExists: true,
        needsBookmarkPush: false
      }
    ]);

    expect(comment).toContain("[#28](https://github.com/MH15/jjacks/pull/28) `mh/base`");
    expect(comment).toContain("  - [#29](https://github.com/MH15/jjacks/pull/29) `mh/alias`");
    expect(comment).toContain("  - **current** [#30](https://github.com/MH15/jjacks/pull/30) `mh/timing`");
  });
});

describe("upsertStackCommentInBody", () => {
  it("appends the stack block to an empty body", () => {
    const body = upsertStackCommentInBody("", [
      "<!-- jjacks:stack -->",
      "hello",
      "<!-- /jjacks:stack -->"
    ].join("\n"));

    expect(body).toContain("hello");
    expect(body.startsWith("<!-- jjacks:stack -->")).toBe(true);
  });

  it("replaces an existing jjacks block without removing surrounding description text", () => {
    const body = upsertStackCommentInBody(
      [
        "Human description.",
        "",
        "<!-- jjacks:stack -->",
        "old stack",
        "<!-- /jjacks:stack -->"
      ].join("\n"),
      [
        "<!-- jjacks:stack -->",
        "new stack",
        "<!-- /jjacks:stack -->"
      ].join("\n")
    );

    expect(body).toContain("Human description.");
    expect(body).toContain("new stack");
    expect(body).not.toContain("old stack");
  });
});
