import { Context, Effect, Layer } from "effect";

import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class GitService extends Context.Tag("GitService")<
  GitService,
  {
    readonly getBookmarkRemoteState: (bookmarkName: string) => Effect.Effect<
      {
        readonly remoteBranchExists: boolean;
        readonly needsBookmarkPush: boolean;
      },
      CliError,
      ProcessService
    >;
    readonly pushBookmark: (
      bookmarkName: string
    ) => Effect.Effect<void, CliError, ProcessService>;
  }
>() {}

const make = {
  getBookmarkRemoteState: (bookmarkName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      const result = yield* process.run("jj", ["bookmark", "list", bookmarkName, "--all-remotes"], {
        allowNonZeroExit: true
      });

      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          new CliError(`Failed to inspect remote state for bookmark ${bookmarkName}.\n${result.stderr || result.stdout}`)
        );
      }

      const originLine = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.startsWith("@origin"));
      const remoteBranchExists = originLine !== undefined;
      const needsBookmarkPush = originLine === undefined || originLine.includes("(ahead by") || originLine.includes("(behind by");

      return {
        remoteBranchExists,
        needsBookmarkPush
      };
    }),

  pushBookmark: (bookmarkName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* process.run("jj", ["git", "push", "--bookmark", bookmarkName]);
    })
};

export const GitServiceLive = Layer.effect(GitService, Effect.succeed(make));
