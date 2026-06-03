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

  executeSync: Effect.gen(function* () {
    const jj = yield* JjService;
    const git = yield* GitService;
    const gh = yield* GitHubService;
    const repo = yield* RepoService;
    const repoInfo = yield* repo.getRepoInfo;
    const entries = yield* getStatusEntries;
    const blankDescriptions = entries
      .map((entry) => entry.entry)
      .filter((entry) => entry.description.trim().length === 0);

    yield* Effect.forEach(blankDescriptions, (entry) => jj.ensureBookmarkDescription(entry.name, entry.name), {
      discard: true
    });

    const describedEntries = blankDescriptions.length === 0 ? entries : yield* getStatusEntries;
    const toPush = describedEntries.filter((entry) => entry.needsBookmarkPush).map((entry) => entry.entry.name);

    yield* Effect.forEach(toPush, (bookmarkName) => git.pushBookmark(bookmarkName), {
      discard: true
    });

    const refreshedEntries = yield* getStatusEntries;
    const refreshedPlan = buildSyncPlanFromStatus(refreshedEntries, repoInfo.defaultBranch ?? "main");
    const createdPullRequestBookmarks: Array<string> = [];
    const updatedPullRequestNumbers: Array<number> = [];
    const updatedCommentPullRequestNumbers: Array<number> = [];

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
    const plan = buildSyncPlanFromStatus(finalEntries, repoInfo.defaultBranch ?? "main");
    const stackComment = renderStackComment(finalEntries);

    yield* Effect.forEach(finalEntries, (entry) =>
      Effect.gen(function* () {
        const pullRequest = entry.pullRequest;
        if (pullRequest === null) {
          return;
        }

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
      }),
      { discard: true }
    );

    return {
      pushedBookmarks: toPush,
      createdPullRequestBookmarks,
      updatedPullRequestNumbers,
      updatedCommentPullRequestNumbers,
      plan,
      statusEntries: finalEntries
    } satisfies ExecuteSyncResult;
  })
};

export const StackServiceLive = Layer.effect(StackService, Effect.succeed(make));
