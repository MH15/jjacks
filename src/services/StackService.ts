import { Context, Effect, Layer } from "effect";

import type { ExecuteSyncResult, StackStatusEntry, SyncPlan } from "../domain";
import { CliError } from "../errors";
import { buildSyncPlanFromStatus, renderStackComment, stackCommentMarker } from "../stack";
import { GitService } from "./GitService";
import { GitHubService } from "./GitHubService";
import { JjService } from "./JjService";
import { ProcessService } from "./ProcessService";
import { RepoService } from "./RepoService";

export class StackService extends Context.Tag("StackService")<
  StackService,
  {
    readonly getStatus: Effect.Effect<
      {
        readonly repoRoot: string;
        readonly entries: ReadonlyArray<StackStatusEntry>;
      },
      import("../errors").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly buildSyncPlan: Effect.Effect<
      SyncPlan,
      import("../errors").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly prepareSync: Effect.Effect<
      {
        readonly defaultBranch: string;
        readonly entries: ReadonlyArray<StackStatusEntry>;
      },
      import("../errors").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly ensureSyncDescriptions: (entries: ReadonlyArray<StackStatusEntry>) => Effect.Effect<
      {
        readonly entries: ReadonlyArray<StackStatusEntry>;
        readonly describedBookmarks: ReadonlyArray<string>;
      },
      import("../errors").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly pushSyncBookmarks: (entries: ReadonlyArray<StackStatusEntry>) => Effect.Effect<
      {
        readonly entries: ReadonlyArray<StackStatusEntry>;
        readonly pushedBookmarks: ReadonlyArray<string>;
      },
      import("../errors").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly reconcileSyncPullRequests: (options: {
      readonly entries: ReadonlyArray<StackStatusEntry>;
      readonly defaultBranch: string;
    }) => Effect.Effect<
      {
        readonly entries: ReadonlyArray<StackStatusEntry>;
        readonly plan: SyncPlan;
        readonly createdPullRequestBookmarks: ReadonlyArray<string>;
        readonly updatedPullRequestNumbers: ReadonlyArray<number>;
      },
      import("../errors").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly syncStackComments: (entries: ReadonlyArray<StackStatusEntry>) => Effect.Effect<
      {
        readonly updatedCommentPullRequestNumbers: ReadonlyArray<number>;
        readonly warnings: ReadonlyArray<string>;
      },
      import("../errors").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly executeSync: Effect.Effect<
      ExecuteSyncResult,
      import("../errors").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
  }
>() {}

const getStatusEntries = Effect.gen(function* () {
  const jj = yield* JjService;
  const gh = yield* GitHubService;
  const git = yield* GitService;
  const stack = yield* jj.getCurrentStack;

  return yield* Effect.forEach(stack, (entry) =>
    Effect.all({
      pullRequest: gh.findPullRequestByHead(entry.branchName),
      remoteState: git.getBookmarkRemoteState(entry.name)
    }).pipe(
      Effect.map(({ pullRequest, remoteState }) => ({
        entry,
        pullRequest,
        remoteBranchExists: remoteState.remoteBranchExists,
        needsBookmarkPush: remoteState.needsBookmarkPush
      }))
    )
  );
});

const prepareSync = Effect.gen(function* () {
  const repo = yield* RepoService;
  const repoInfo = yield* repo.getRepoInfo;
  const entries = yield* getStatusEntries;

  return {
    defaultBranch: repoInfo.defaultBranch ?? "main",
    entries
  };
});

const ensureSyncDescriptions = (entries: ReadonlyArray<StackStatusEntry>) =>
  Effect.gen(function* () {
    const jj = yield* JjService;
    const blankDescriptions = entries
      .map((entry) => entry.entry)
      .filter((entry) => entry.description.trim().length === 0);

    yield* Effect.forEach(blankDescriptions, (entry) => jj.ensureBookmarkDescription(entry.name, entry.name), {
      discard: true
    });

    return {
      entries: blankDescriptions.length === 0 ? entries : yield* getStatusEntries,
      describedBookmarks: blankDescriptions.map((entry) => entry.name)
    };
  });

const pushSyncBookmarks = (entries: ReadonlyArray<StackStatusEntry>) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const toPush = entries.filter((entry) => entry.needsBookmarkPush).map((entry) => entry.entry.name);

    yield* Effect.forEach(toPush, (bookmarkName) => git.pushBookmark(bookmarkName), {
      discard: true
    });

    return {
      entries: toPush.length === 0 ? entries : yield* getStatusEntries,
      pushedBookmarks: toPush
    };
  });

const reconcileSyncPullRequests = ({
  entries,
  defaultBranch
}: {
  readonly entries: ReadonlyArray<StackStatusEntry>;
  readonly defaultBranch: string;
}) =>
  Effect.gen(function* () {
    const gh = yield* GitHubService;
    const refreshedPlan = buildSyncPlanFromStatus(entries, defaultBranch);
    const createdPullRequestBookmarks: Array<string> = [];
    const updatedPullRequestNumbers: Array<number> = [];

    yield* Effect.forEach(refreshedPlan.stack, (planEntry) =>
      Effect.gen(function* () {
        if (planEntry.pullRequest === null) {
          if (!planEntry.remoteBranchExists) {
            return yield* Effect.fail(
              new CliError(
                `Bookmark ${planEntry.entry.name} is still not published on origin after push. ` +
                  `Run "jj bookmark list ${planEntry.entry.name} --all-remotes" to inspect its remote state.`
              )
            );
          }

          yield* gh.createPullRequest({
            headBranch: planEntry.entry.branchName,
            baseBranch: planEntry.intendedBaseBranch,
            title: planEntry.entry.name
          });
          createdPullRequestBookmarks.push(planEntry.entry.name);
          return;
        }

        const nextBase =
          planEntry.pullRequest.baseRefName !== planEntry.intendedBaseBranch ? planEntry.intendedBaseBranch : undefined;
        const nextTitle = planEntry.pullRequest.title !== planEntry.entry.name ? planEntry.entry.name : undefined;

        if (nextBase === undefined && nextTitle === undefined) {
          return;
        }

        const updateOptions: {
          readonly number: number;
          readonly baseBranch?: string;
          readonly title?: string;
        } = {
          number: planEntry.pullRequest.number
        };

        if (nextBase !== undefined) {
          Object.assign(updateOptions, { baseBranch: nextBase });
        }

        if (nextTitle !== undefined) {
          Object.assign(updateOptions, { title: nextTitle });
        }

        yield* gh.updatePullRequest(updateOptions);
        updatedPullRequestNumbers.push(planEntry.pullRequest.number);
      }),
      { discard: true }
    );

    const finalEntries = yield* getStatusEntries;

    return {
      entries: finalEntries,
      plan: buildSyncPlanFromStatus(finalEntries, defaultBranch),
      createdPullRequestBookmarks,
      updatedPullRequestNumbers
    };
  });

const syncStackComments = (entries: ReadonlyArray<StackStatusEntry>) =>
  Effect.gen(function* () {
    const gh = yield* GitHubService;
    const updatedCommentPullRequestNumbers: Array<number> = [];
    const warnings: Array<string> = [];

    yield* Effect.forEach(entries, (entry) =>
      Effect.gen(function* () {
        const pullRequest = entry.pullRequest;
        if (pullRequest === null) {
          return;
        }
        const stackComment = renderStackComment(entries, pullRequest.number);

        const outcome = yield* Effect.either(
          Effect.gen(function* () {
            const comments = yield* gh.listIssueComments(pullRequest.number);
            const existing = comments.find((comment) => comment.body.includes(stackCommentMarker));

            if (existing === undefined) {
              yield* gh.createIssueComment({
                pullRequestNumber: pullRequest.number,
                body: stackComment
              });
            } else if (existing.body !== stackComment) {
              yield* gh.updateIssueComment({
                commentId: existing.id,
                body: stackComment
              });
            } else {
              return;
            }

            updatedCommentPullRequestNumbers.push(pullRequest.number);
          })
        );

        if (outcome._tag === "Left") {
          const error = outcome.left;
          warnings.push(`failed to sync stack comment for PR #${pullRequest.number}: ${error.message}`);
        }
      }),
      { discard: true }
    );

    return {
      updatedCommentPullRequestNumbers,
      warnings
    };
  });

const executeSync = Effect.gen(function* () {
  const prepared = yield* prepareSync;
  const entries = prepared.entries;
  if (entries.length === 0) {
    return {
      pushedBookmarks: [],
      createdPullRequestBookmarks: [],
      updatedPullRequestNumbers: [],
      updatedCommentPullRequestNumbers: [],
      warnings: [],
      plan: buildSyncPlanFromStatus([], prepared.defaultBranch),
      statusEntries: []
    } satisfies ExecuteSyncResult;
  }

  const descriptions = yield* ensureSyncDescriptions(entries);
  const pushes = yield* pushSyncBookmarks(descriptions.entries);
  const prs = yield* reconcileSyncPullRequests({
    entries: pushes.entries,
    defaultBranch: prepared.defaultBranch
  });
  const comments = yield* syncStackComments(prs.entries);

  return {
    pushedBookmarks: pushes.pushedBookmarks,
    createdPullRequestBookmarks: prs.createdPullRequestBookmarks,
    updatedPullRequestNumbers: prs.updatedPullRequestNumbers,
    updatedCommentPullRequestNumbers: comments.updatedCommentPullRequestNumbers,
    warnings: comments.warnings,
    plan: prs.plan,
    statusEntries: prs.entries
  } satisfies ExecuteSyncResult;
});

const make = {
  getStatus: Effect.gen(function* () {
    const repo = yield* RepoService;
    const repoInfo = yield* repo.getRepoInfo;
    const entries = yield* getStatusEntries;

    return {
      repoRoot: repoInfo.root,
      entries
    };
  }),

  buildSyncPlan: Effect.gen(function* () {
    const repo = yield* RepoService;
    const repoInfo = yield* repo.getRepoInfo;
    const entries = yield* getStatusEntries;

    return buildSyncPlanFromStatus(entries, repoInfo.defaultBranch ?? "main") satisfies SyncPlan;
  }),

  prepareSync,
  ensureSyncDescriptions,
  pushSyncBookmarks,
  reconcileSyncPullRequests,
  syncStackComments,
  executeSync
};

export const StackServiceLive = Layer.effect(StackService, Effect.succeed(make));
