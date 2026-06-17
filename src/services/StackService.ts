import { Context, Effect, Layer } from "effect";

import type { ExecuteSyncResult, StackStatusEntry, SyncPlan } from "../domain";
import { CliError } from "../errors";
import {
  analyzeReviewStack,
  buildSyncPlanFromStatus,
  isPullRequestOpen,
  renderStackComment,
  stackCommentMarker,
  upsertStackCommentInBody,
} from "../stack";
import { GitService } from "./GitService";
import { GitHubService } from "./GitHubService";
import { JjService } from "./JjService";
import { ProcessService } from "./ProcessService";
import { RepoService } from "./RepoService";

export interface PreparedSyncState {
  readonly defaultBranch: string;
  readonly entries: ReadonlyArray<StackStatusEntry>;
  readonly preparedAtMs: number;
}

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
      PreparedSyncState,
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
    readonly refreshLocalStackFromPrepared: (prepared: PreparedSyncState) => Effect.Effect<
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
    readonly pushSyncBookmarks: (options: {
      readonly entries: ReadonlyArray<StackStatusEntry>;
      readonly defaultBranch: string;
    }) => Effect.Effect<
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
    git.getBookmarksRemoteState(bookmarkNames),
  ]);

  const entries = stack.map((entry) => {
    const pullRequest = pullRequestsByHead.get(entry.branchName) ?? null;
    const remoteState = remoteStatesByBookmark.get(entry.name) ?? {
      remoteBranchExists: false,
      needsBookmarkPush: true,
    };

    return {
      entry,
      pullRequest,
      remoteBranchExists: remoteState.remoteBranchExists,
      needsBookmarkPush: remoteState.needsBookmarkPush,
    };
  });

  return annotateConflictBlocks(entries);
});

const annotateConflictBlocks = (
  entries: ReadonlyArray<Omit<StackStatusEntry, "blockedBy">>,
): ReadonlyArray<StackStatusEntry> => {
  const byName = new Map(entries.map((entry) => [entry.entry.name, entry] as const));
  const childrenByParent = new Map<
    string | undefined,
    Array<Omit<StackStatusEntry, "blockedBy">>
  >();

  for (const entry of entries) {
    const existing = childrenByParent.get(entry.entry.parentBookmarkName) ?? [];
    existing.push(entry);
    childrenByParent.set(entry.entry.parentBookmarkName, existing);
  }

  const result = new Map<string, StackStatusEntry>();
  const visit = (
    entry: Omit<StackStatusEntry, "blockedBy">,
    inheritedBlock: string | undefined,
  ): void => {
    const blockedBy =
      inheritedBlock ?? (entry.entry.hasConflict === true ? entry.entry.name : undefined);
    result.set(entry.entry.name, {
      ...entry,
      ...(blockedBy === undefined ? {} : { blockedBy }),
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
    entries,
    preparedAtMs: Date.now(),
  };
});

const refreshLocalStackWithInitialState = ({
  defaultBranch,
  initialEntries,
}: {
  readonly defaultBranch: string;
  readonly initialEntries: ReadonlyArray<StackStatusEntry>;
}) =>
  Effect.gen(function* () {
    const repo = yield* RepoService;
    const jj = yield* JjService;
    const initialAnalysis = analyzeReviewStack(initialEntries, defaultBranch);

    if (initialAnalysis.completionState === "empty") {
      return {
        defaultBranch,
        entries: initialEntries,
      };
    }

    yield* repo.fetchOrigin;
    yield* jj.syncBookmarkToRemote(defaultBranch);

    const entries = yield* getCurrentStatusEntries;
    const analysis = analyzeReviewStack(entries, defaultBranch);

    if (analysis.completionState === "stack-complete") {
      yield* jj.moveToTrunkContinuation(defaultBranch);
    } else if (
      analysis.rootSyncableEntry !== undefined &&
      analysis.currentSyncableEntry !== undefined
    ) {
      yield* jj.editWorkingCopyOnStack({
        rootBookmarkName: analysis.rootSyncableEntry.entry.name,
        currentBookmarkName: analysis.currentSyncableEntry.entry.name,
        defaultBranch: analysis.rootSyncableEntry.intendedBaseBranch,
      });
    }

    return {
      defaultBranch,
      entries: yield* getCurrentStatusEntries,
    };
  });

const refreshLocalStack = Effect.gen(function* () {
  const repo = yield* RepoService;
  const repoInfo = yield* repo.getRepoInfo;
  const defaultBranch = repoInfo.defaultBranch ?? "main";
  const initialEntries = yield* getCurrentStatusEntries;

  return yield* refreshLocalStackWithInitialState({
    defaultBranch,
    initialEntries,
  });
});

const refreshLocalStackFromPrepared = (prepared: PreparedSyncState) =>
  refreshLocalStackWithInitialState({
    defaultBranch: prepared.defaultBranch,
    initialEntries: prepared.entries,
  });

const syncableEntries = (
  entries: ReadonlyArray<StackStatusEntry>,
): ReadonlyArray<StackStatusEntry> => analyzeReviewStack(entries, "main").syncableEntries;

const ensureSyncDescriptions = (entries: ReadonlyArray<StackStatusEntry>) =>
  Effect.gen(function* () {
    const jj = yield* JjService;
    const blankDescriptions = syncableEntries(entries)
      .map((entry) => entry.entry)
      .filter((entry) => entry.description.trim().length === 0);

    yield* Effect.forEach(
      blankDescriptions,
      (entry) => jj.ensureBookmarkDescription(entry.name, entry.name),
      {
        discard: true,
        concurrency: 4,
      },
    );

    return {
      entries: blankDescriptions.length === 0 ? entries : yield* getCurrentStatusEntries,
      describedBookmarks: blankDescriptions.map((entry) => entry.name),
    };
  });

const formatCommitCount = (count: number) => `${count} commit${count === 1 ? "" : "s"}`;

const failMultiCommitPush = (
  offenders: ReadonlyArray<{
    readonly entry: ReturnType<typeof analyzeReviewStack>["syncableEntries"][number];
    readonly commitCount: number;
  }>,
) => {
  const first = offenders[0]!;
  return Effect.fail(
    new CliError(
      [
        offenders.length === 1
          ? `Bookmark ${first.entry.entry.name} would push ${formatCommitCount(first.commitCount)} onto ${first.entry.intendedBaseBranch}, but jjacks requires exactly one commit per PR.`
          : [
              `These bookmarks would push more than one commit, but jjacks requires exactly one commit per PR:`,
              ...offenders.map(
                (offender) =>
                  `- ${offender.entry.entry.name} onto ${offender.entry.intendedBaseBranch}: ${formatCommitCount(offender.commitCount)}`,
              ),
            ].join("\n"),
        "",
        `Squash each bookmark to one commit manually, then rerun "jjacks sync".`,
        "",
        "Useful commands:",
        `  jj log -r '${first.entry.intendedBaseBranch}..${first.entry.entry.name}'`,
        "  jj squash -r <extra-change> --into <kept-change>",
        `  jjacks sync`,
      ].join("\n"),
    ),
  );
};

const pushSyncBookmarks = ({
  entries,
  defaultBranch,
}: {
  readonly entries: ReadonlyArray<StackStatusEntry>;
  readonly defaultBranch: string;
}) =>
  Effect.gen(function* () {
    const git = yield* GitService;
    const jj = yield* JjService;
    const entriesToPush = analyzeReviewStack(entries, defaultBranch).syncableEntries.filter(
      (entry) =>
        entry.needsBookmarkPush &&
        !(entry.entry.isEmpty === true && entry.pullRequest === null) &&
        (entry.pullRequest === null || isPullRequestOpen(entry.pullRequest)),
    );
    const toPush = entriesToPush.map((entry) => entry.entry.name);

    const offenders = (yield* Effect.forEach(
      entriesToPush,
      (entry) =>
        Effect.gen(function* () {
          const commitCount = yield* jj.countCommitsInRange({
            baseRevision: entry.intendedBaseBranch,
            headRevision: entry.entry.name,
          });
          return commitCount === 1
            ? null
            : {
                entry,
                commitCount,
              };
        }),
      { concurrency: 4 },
    )).filter((offender): offender is NonNullable<typeof offender> => offender !== null);

    if (offenders.length > 0) {
      return yield* failMultiCommitPush(offenders);
    }

    yield* git.pushBookmarks(toPush);

    return {
      entries: toPush.length === 0 ? entries : yield* getCurrentStatusEntries,
      pushedBookmarks: toPush,
    };
  });

const reconcileSyncPullRequests = ({
  entries,
  defaultBranch,
}: {
  readonly entries: ReadonlyArray<StackStatusEntry>;
  readonly defaultBranch: string;
}) =>
  Effect.gen(function* () {
    const gh = yield* GitHubService;
    const jj = yield* JjService;
    const repo = yield* RepoService;
    const repoInfo = yield* repo.getRepoInfo;
    const stackCommentLocation = yield* jj.getStackCommentLocation;
    const pullRequestUseTemplate = yield* jj.getPullRequestUseTemplate;
    const refreshedPlan = buildSyncPlanFromStatus(entries, defaultBranch);
    const createdPullRequestBookmarks: Array<string> = [];
    const updatedPullRequestNumbers: Array<number> = [];

    const effectiveEntries = analyzeReviewStack(entries, defaultBranch).syncableEntries;

    yield* Effect.forEach(
      refreshedPlan.githubActions,
      (planEntry) =>
        Effect.gen(function* () {
          if (planEntry.pullRequest === null) {
            if (!planEntry.remoteBranchExists) {
              return yield* Effect.fail(
                new CliError(
                  `Bookmark ${planEntry.entry.name} is still not published on origin after push. ` +
                    `Run "jj bookmark list ${planEntry.entry.name} --all-remotes" to inspect its remote state.`,
                ),
              );
            }

            yield* gh.createPullRequest({
              repoRoot: repoInfo.root,
              headBranch: planEntry.entry.branchName,
              baseBranch: planEntry.intendedBaseBranch,
              title: planEntry.entry.name,
              useTemplate: pullRequestUseTemplate,
            });
            createdPullRequestBookmarks.push(planEntry.entry.name);
            return;
          }

          if (!isPullRequestOpen(planEntry.pullRequest)) {
            return;
          }

          const nextBase =
            planEntry.pullRequest.baseRefName !== planEntry.intendedBaseBranch
              ? planEntry.intendedBaseBranch
              : undefined;
          const nextBody =
            stackCommentLocation === "description"
              ? upsertStackCommentInBody(
                  planEntry.pullRequest.body,
                  renderStackComment(effectiveEntries, planEntry.pullRequest.number),
                )
              : undefined;

          if (
            nextBase === undefined &&
            (nextBody === undefined || nextBody === planEntry.pullRequest.body)
          ) {
            return;
          }

          const updateOptions: {
            readonly number: number;
            readonly baseBranch?: string;
            readonly body?: string;
          } = {
            number: planEntry.pullRequest.number,
          };

          if (nextBase !== undefined) {
            Object.assign(updateOptions, { baseBranch: nextBase });
          }

          if (nextBody !== undefined && nextBody !== planEntry.pullRequest.body) {
            Object.assign(updateOptions, { body: nextBody });
          }

          yield* gh.updatePullRequest(updateOptions);
          updatedPullRequestNumbers.push(planEntry.pullRequest.number);
        }),
      { discard: true, concurrency: 4 },
    );

    const finalEntries = yield* getCurrentStatusEntries;

    return {
      entries: finalEntries,
      plan: buildSyncPlanFromStatus(finalEntries, defaultBranch),
      createdPullRequestBookmarks,
      updatedPullRequestNumbers,
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
      yield* Effect.forEach(
        syncableEntries(entries),
        (entry) =>
          Effect.gen(function* () {
            const pullRequest = entry.pullRequest;
            if (pullRequest === null || !isPullRequestOpen(pullRequest)) {
              return;
            }

            const entriesForComment = syncableEntries(entries);
            const nextBody = upsertStackCommentInBody(
              pullRequest.body,
              renderStackComment(entriesForComment, pullRequest.number),
            );

            if (nextBody === pullRequest.body) {
              return;
            }

            yield* gh.updatePullRequest({
              number: pullRequest.number,
              body: nextBody,
            });
            updatedCommentPullRequestNumbers.push(pullRequest.number);
          }),
        { discard: true, concurrency: 4 },
      );

      return {
        updatedCommentPullRequestNumbers,
        warnings,
      };
    }

    yield* Effect.forEach(
      syncableEntries(entries),
      (entry) =>
        Effect.gen(function* () {
          const pullRequest = entry.pullRequest;
          if (pullRequest === null || !isPullRequestOpen(pullRequest)) {
            return;
          }
          const stackComment = renderStackComment(syncableEntries(entries), pullRequest.number);

          const outcome = yield* Effect.either(
            Effect.gen(function* () {
              const comments = yield* gh.listIssueComments(pullRequest.number);
              const existing = comments.find((comment) =>
                comment.body.includes(stackCommentMarker),
              );

              if (existing === undefined) {
                yield* gh.createIssueComment({
                  pullRequestNumber: pullRequest.number,
                  body: stackComment,
                });
              } else if (existing.body !== stackComment) {
                yield* gh.updateIssueComment({
                  commentId: existing.id,
                  body: stackComment,
                });
              } else {
                return;
              }

              updatedCommentPullRequestNumbers.push(pullRequest.number);
            }),
          );

          if (outcome._tag === "Left") {
            const error = outcome.left;
            warnings.push(
              `failed to sync stack comment for PR #${pullRequest.number}: ${error.message}`,
            );
          }
        }),
      { discard: true, concurrency: 4 },
    );

    return {
      updatedCommentPullRequestNumbers,
      warnings,
    };
  });

const executeSync = Effect.gen(function* () {
  const prepared = yield* refreshLocalStack;
  const entries = prepared.entries;
  const initialPlan = buildSyncPlanFromStatus(entries, prepared.defaultBranch);
  if (initialPlan.completionState !== "active-stack") {
    return {
      pushedBookmarks: [],
      createdPullRequestBookmarks: [],
      updatedPullRequestNumbers: [],
      updatedCommentPullRequestNumbers: [],
      warnings: [],
      plan: initialPlan,
      statusEntries: entries,
    } satisfies ExecuteSyncResult;
  }

  const descriptions = yield* ensureSyncDescriptions(entries);
  const pushes = yield* pushSyncBookmarks({
    entries: descriptions.entries,
    defaultBranch: prepared.defaultBranch,
  });
  const prs = yield* reconcileSyncPullRequests({
    entries: pushes.entries,
    defaultBranch: prepared.defaultBranch,
  });
  const comments = yield* syncStackComments(prs.entries);

  return {
    pushedBookmarks: pushes.pushedBookmarks,
    createdPullRequestBookmarks: prs.createdPullRequestBookmarks,
    updatedPullRequestNumbers: prs.updatedPullRequestNumbers,
    updatedCommentPullRequestNumbers: comments.updatedCommentPullRequestNumbers,
    warnings: comments.warnings,
    plan: prs.plan,
    statusEntries: prs.entries,
  } satisfies ExecuteSyncResult;
});

const make = {
  getStatus: Effect.gen(function* () {
    const repo = yield* RepoService;
    const repoInfo = yield* repo.getRepoInfo;
    const entries = yield* getCurrentStatusEntries;

    return {
      repoRoot: repoInfo.root,
      entries,
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
  refreshLocalStackFromPrepared,
  ensureSyncDescriptions,
  pushSyncBookmarks,
  reconcileSyncPullRequests,
  syncStackComments,
  executeSync,
};

export const StackServiceLive = Layer.succeed(StackService, make);
