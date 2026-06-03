import { Context, Effect, Layer } from "effect";

import type { PullRequestSummary } from "../domain.js";
import { CliError } from "../errors.js";
import { ProcessService } from "./ProcessService.js";

export class GitHubService extends Context.Tag("GitHubService")<
  GitHubService,
  {
    readonly findPullRequestByHead: (
      branchName: string
    ) => Effect.Effect<PullRequestSummary | null, CliError, ProcessService>;
  }
>() {}

const make = {
  findPullRequestByHead: (branchName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      const result = yield* process.run(
        "gh",
        [
          "pr",
          "list",
          "--head",
          branchName,
          "--json",
          "number,url,title,headRefName,baseRefName,isDraft",
          "--limit",
          "1"
        ],
        { allowNonZeroExit: true }
      );

      if (result.exitCode !== 0 || result.stdout.length === 0) {
        return null;
      }

      const parsed = JSON.parse(result.stdout) as Array<PullRequestSummary>;
      return parsed[0] ?? null;
    })
};

export const GitHubServiceLive = Layer.effect(GitHubService, Effect.succeed(make));
