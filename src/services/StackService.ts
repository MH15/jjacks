import { Context, Effect, Layer } from "effect";

import type { ExecuteSyncResult, StackStatusEntry, SyncPlan } from "../domain.js";
import { buildSyncPlanFromStatus } from "../stack.js";
import { GitService } from "./GitService.js";
import { GitHubService } from "./GitHubService.js";
import { JjService } from "./JjService.js";
import { ProcessService } from "./ProcessService.js";
import { RepoService } from "./RepoService.js";

export class StackService extends Context.Tag("StackService")<
  StackService,
  {
    readonly getStatus: Effect.Effect<
      {
        readonly repoRoot: string;
        readonly entries: ReadonlyArray<StackStatusEntry>;
      },
      import("../errors.js").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly buildSyncPlan: Effect.Effect<
      SyncPlan,
      import("../errors.js").CliError,
      JjService | GitHubService | GitService | RepoService | ProcessService
    >;
    readonly executeSync: Effect.Effect<
      ExecuteSyncResult,
      import("../errors.js").CliError,
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
      remoteBranchExists: git.remoteBranchExists(entry.branchName)
    }).pipe(
      Effect.map(({ pullRequest, remoteBranchExists }) => ({
        entry,
        pullRequest,
        remoteBranchExists
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
    const git = yield* GitService;
    const gh = yield* GitHubService;
    const repo = yield* RepoService;
    const repoInfo = yield* repo.getRepoInfo;
    const entries = yield* getStatusEntries;
    const toPush = entries.filter((entry) => !entry.remoteBranchExists).map((entry) => entry.entry.name);

    yield* Effect.forEach(toPush, (bookmarkName) => git.pushBookmark(bookmarkName), {
      discard: true
    });

    const refreshedEntries = yield* getStatusEntries;
    const refreshedPlan = buildSyncPlanFromStatus(refreshedEntries, repoInfo.defaultBranch ?? "main");
    const createdPullRequestBookmarks: Array<string> = [];
    const updatedPullRequestNumbers: Array<number> = [];

    yield* Effect.forEach(refreshedPlan.stack, (planEntry) =>
      Effect.gen(function* () {
        if (planEntry.pullRequest === null) {
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

    return {
      pushedBookmarks: toPush,
      createdPullRequestBookmarks,
      updatedPullRequestNumbers,
      plan,
      statusEntries: finalEntries
    } satisfies ExecuteSyncResult;
  })
};

export const StackServiceLive = Layer.effect(StackService, Effect.succeed(make));
