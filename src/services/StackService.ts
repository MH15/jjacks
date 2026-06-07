import { Context, Effect, Layer } from "effect";

import type { ExecuteSyncResult, StackStatusEntry, SyncPlan } from "../domain";
import { CliError } from "../errors";
import { buildSyncPlanFromStatus, isPullRequestOpen, renderStackComment, stackCommentMarker, upsertStackCommentInBody } from "../stack";
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
    readonly refreshLocalStack: Effect.Effect<
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

const getCurrentStatusEntries = Effect.gen(function* () {
  const jj = yield* JjService;
  const gh = yield* GitHubService;
  const git = yield* GitService;
  const stack = yield* jj.getCurrentTree;
  if (stack.length === 0) {
    return [];
  }
  const bookmarkNames = stack.map((entry) => entry.name);
  const branchNames = stack.map((entry) => entry.branchName);

  const [pullRequestsByHead, remoteStatesByBookmark] = yield* Effect.all([
    gh.findPullRequestsByHeads(branchNames),
    git.getBookmarksRemoteState(bookmarkNames)
  ]);

  const entries = stack.map((entry) => {
    const pullRequest = pullRequestsByHead.get(entry.branchName) ?? null;
    const remoteState = remoteStatesByBookmark.get(entry.name) ?? {
      remoteBranchExists: false,
      needsBookmarkPush: true
    };

    return {
      entry,
      pullRequest,
      remoteBranchExists: remoteState.remoteBranchExists,
      needsBookmarkPush: remoteState.needsBookmarkPush
    };
  });

  return annotateConflictBlocks(entries);
});

const annotateConflictBlocks = (
  entries: ReadonlyArray<Omit<StackStatusEntry, "blockedBy">>
): ReadonlyArray<StackStatusEntry> => {
  const byName = new Map(entries.map((entry) => [entry.entry.name, entry] as const));
  const childrenByParent = new Map<string | undefined, Array<Omit<StackStatusEntry, "blockedBy">>>();

  for (const entry of entries) {
    const existing = childrenByParent.get(entry.entry.parentBookmarkName) ?? [];
    existing.push(entry);
    childrenByParent.set(entry.entry.parentBookmarkName, existing);
  }

  const result = new Map<string, StackStatusEntry>();
  const visit = (entry: Omit<StackStatusEntry, "blockedBy">, inheritedBlock: string | undefined): void => {
    const blockedBy = inheritedBlock ?? (entry.entry.hasConflict === true ? entry.entry.name : undefined);
    result.set(entry.entry.name, {
      ...entry,
      ...(blockedBy === undefined ? {} : { blockedBy })
    });

    for (const child of childrenByParent.get(entry.entry.name) ?? []) {
      visit(child, blockedBy);
    }
  };

  for (const entry of entries) {
    const parentName = entry.entry.parentBookmarkName;
    if (parentName === undefined || !byName.has(parentName)) {
      visit(entry, undefined);
    }
  }

  return entries.map((entry) => result.get(entry.entry.name) ?? entry);
};

const prepareSync = Effect.gen(function* () {
  const repo = yield* RepoService;
  const repoInfo = yield* repo.getRepoInfo;
  const entries = yield* getCurrentStatusEntries;

  return {
    defaultBranch: repoInfo.defaultBranch ?? "main",
    entries
  };
});

const refreshLocalStack = Effect.gen(function* () {
  const repo = yield* RepoService;
  const jj = yield* JjService;
  yield* repo.fetchOrigin;
  const repoInfo = yield* repo.getRepoInfo;
  const defaultBranch = repoInfo.defaultBranch ?? "main";
  yield* jj.syncBookmarkToRemote(defaultBranch);

  const entries = yield* getCurrentStatusEntries;
  const currentEntry = entries.find((entry) => entry.entry.isCurrent)?.entry;
  const rootEntry = entries.find((entry) =>
    entry.blockedBy === undefined &&
    !(entry.entry.isEmpty === true && entry.pullRequest === null) &&
    (entry.pullRequest === null || isPullRequestOpen(entry.pullRequest))
  )?.entry;

  if (rootEntry !== undefined && currentEntry !== undefined) {
    yield* jj.continueWorkingCopyOnStack({
      rootBookmarkName: rootEntry.name,
      currentBookmarkName: currentEntry.name,
      defaultBranch,
      message: `Continue ${currentEntry.name}`
    });
  }

  return {
    defaultBranch,
    entries: yield* getCurrentStatusEntries
  };
});

const syncableEntries = (entries: ReadonlyArray<StackStatusEntry>): ReadonlyArray<StackStatusEntry> =>
  entries.filter((entry) => entry.blockedBy === undefined);

const ensureSyncDescriptions = (entries: ReadonlyArray<StackStatusEntry>) =>
  Effect.gen(function* () {
    const jj = yield* JjService;
    const blankDescriptions = syncableEntries(entries)
      .map((entry) => entry.entry)
      .filter((entry) => entry.description.trim().length === 0);

    yield* Effect.forEach(blankDescriptions, (entry) => jj.ensureBookmarkDescription(entry.name, entry.name), {
      discard: true,
      concurrency: 4
    });

    return {
      entries: blankDescriptions.length === 0 ? entries : yield* getCurrentStatusEntries,
      describedBookmarks: blankDescriptions.map((entry) => entry.name)
    };
  });

const pushSyncBookmarks = (entries: ReadonlyArray<StackStatusEntry>) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const toPush = syncableEntries(entries)
      .filter((entry) =>
        entry.needsBookmarkPush &&
        !(entry.entry.isEmpty === true && entry.pullRequest === null) &&
        (entry.pullRequest === null || isPullRequestOpen(entry.pullRequest))
      )
      .map((entry) => entry.entry.name);

    yield* git.pushBookmarks(toPush);

    return {
      entries: toPush.length === 0 ? entries : yield* getCurrentStatusEntries,
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
    const jj = yield* JjService;
    const stackCommentLocation = yield* jj.getStackCommentLocation;
    const refreshedPlan = buildSyncPlanFromStatus(entries, defaultBranch);
    const createdPullRequestBookmarks: Array<string> = [];
    const updatedPullRequestNumbers: Array<number> = [];

    yield* Effect.forEach(refreshedPlan.stack, (planEntry) =>
      Effect.gen(function* () {
        if (entries.find((entry) => entry.entry.name === planEntry.entry.name)?.blockedBy !== undefined) {
          return;
        }

        if (planEntry.pullRequest === null && planEntry.entry.isEmpty === true) {
          return;
        }

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

        if (!isPullRequestOpen(planEntry.pullRequest)) {
          return;
        }

        const nextBase =
          planEntry.pullRequest.baseRefName !== planEntry.intendedBaseBranch ? planEntry.intendedBaseBranch : undefined;
        const nextTitle = planEntry.pullRequest.title !== planEntry.entry.name ? planEntry.entry.name : undefined;
        const nextBody =
          stackCommentLocation === "description"
            ? upsertStackCommentInBody(
                planEntry.pullRequest.body,
                renderStackComment(entries, planEntry.pullRequest.number)
              )
            : undefined;

        if (
          nextBase === undefined &&
          nextTitle === undefined &&
          (nextBody === undefined || nextBody === planEntry.pullRequest.body)
        ) {
          return;
        }

        const updateOptions: {
          readonly number: number;
          readonly baseBranch?: string;
          readonly title?: string;
          readonly body?: string;
        } = {
          number: planEntry.pullRequest.number
        };

        if (nextBase !== undefined) {
          Object.assign(updateOptions, { baseBranch: nextBase });
        }

        if (nextTitle !== undefined) {
          Object.assign(updateOptions, { title: nextTitle });
        }

        if (nextBody !== undefined && nextBody !== planEntry.pullRequest.body) {
          Object.assign(updateOptions, { body: nextBody });
        }

        yield* gh.updatePullRequest(updateOptions);
        updatedPullRequestNumbers.push(planEntry.pullRequest.number);
      }),
      { discard: true, concurrency: 4 }
    );

    const finalEntries = yield* getCurrentStatusEntries;

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
    const jj = yield* JjService;
    const stackCommentLocation = yield* jj.getStackCommentLocation;
    const updatedCommentPullRequestNumbers: Array<number> = [];
    const warnings: Array<string> = [];

    if (stackCommentLocation === "description") {
      yield* Effect.forEach(syncableEntries(entries), (entry) =>
        Effect.gen(function* () {
          const pullRequest = entry.pullRequest;
          if (pullRequest === null || !isPullRequestOpen(pullRequest)) {
            return;
          }

          const nextBody = upsertStackCommentInBody(
            pullRequest.body,
            renderStackComment(entries, pullRequest.number)
          );

          if (nextBody === pullRequest.body) {
            return;
          }

          yield* gh.updatePullRequest({
            number: pullRequest.number,
            body: nextBody
          });
          updatedCommentPullRequestNumbers.push(pullRequest.number);
        }),
        { discard: true, concurrency: 4 }
      );

      return {
        updatedCommentPullRequestNumbers,
        warnings
      };
    }

    yield* Effect.forEach(syncableEntries(entries), (entry) =>
      Effect.gen(function* () {
        const pullRequest = entry.pullRequest;
        if (pullRequest === null || !isPullRequestOpen(pullRequest)) {
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
      { discard: true, concurrency: 4 }
    );

    return {
      updatedCommentPullRequestNumbers,
      warnings
    };
  });

const executeSync = Effect.gen(function* () {
  const prepared = yield* refreshLocalStack;
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
    const entries = yield* getCurrentStatusEntries;

    return {
      repoRoot: repoInfo.root,
      entries
    };
  }),

  buildSyncPlan: Effect.gen(function* () {
    const repo = yield* RepoService;
    const repoInfo = yield* repo.getRepoInfo;
    const entries = yield* getCurrentStatusEntries;

    return buildSyncPlanFromStatus(entries, repoInfo.defaultBranch ?? "main") satisfies SyncPlan;
  }),

  prepareSync,
  refreshLocalStack,
  ensureSyncDescriptions,
  pushSyncBookmarks,
  reconcileSyncPullRequests,
  syncStackComments,
  executeSync
};

export const StackServiceLive = Layer.succeed(StackService, make);
