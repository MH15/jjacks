import { Context, Effect, Layer } from "effect";

import type { StackStatusEntry, SyncPlan } from "../domain.js";
import { buildSyncPlanFromStatus } from "../stack.js";
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
      JjService | GitHubService | RepoService | ProcessService
    >;
    readonly buildSyncPlan: Effect.Effect<
      SyncPlan,
      import("../errors.js").CliError,
      JjService | GitHubService | RepoService | ProcessService
    >;
  }
>() {}

const getStatusEntries = Effect.gen(function* () {
  const jj = yield* JjService;
  const gh = yield* GitHubService;
  const stack = yield* jj.getCurrentStack;

  return yield* Effect.forEach(stack, (entry) =>
    Effect.map(gh.findPullRequestByHead(entry.branchName), (pullRequest) => ({
      entry,
      pullRequest
    }))
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
  })
};

export const StackServiceLive = Layer.effect(StackService, Effect.succeed(make));
