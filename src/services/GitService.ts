import { Context, Effect, Layer } from "effect";

import { CliError } from "../errors.js";
import { ProcessService } from "./ProcessService.js";

export class GitService extends Context.Tag("GitService")<
  GitService,
  {
    readonly remoteBranchExists: (
      branchName: string
    ) => Effect.Effect<boolean, CliError, ProcessService>;
    readonly pushBookmark: (
      bookmarkName: string
    ) => Effect.Effect<void, CliError, ProcessService>;
  }
>() {}

const make = {
  remoteBranchExists: (branchName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      const result = yield* process.run(
        "git",
        ["ls-remote", "--heads", "origin", branchName],
        { allowNonZeroExit: true }
      );

      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          new CliError(`Failed to check whether origin/${branchName} exists.\n${result.stderr || result.stdout}`)
        );
      }

      return result.stdout.length > 0;
    }),

  pushBookmark: (bookmarkName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* process.run("jj", ["git", "push", "--bookmark", bookmarkName]);
    })
};

export const GitServiceLive = Layer.effect(GitService, Effect.succeed(make));
