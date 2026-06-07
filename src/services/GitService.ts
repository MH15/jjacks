import { Context, Effect, Layer } from "effect";

import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class GitService extends Context.Tag("GitService")<
  GitService,
  {
    readonly getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) => Effect.Effect<
      ReadonlyMap<
        string,
        {
          readonly remoteBranchExists: boolean;
          readonly needsBookmarkPush: boolean;
        }
      >,
      CliError,
      ProcessService
    >;
    readonly getBookmarkRemoteState: (bookmarkName: string) => Effect.Effect<
      {
        readonly remoteBranchExists: boolean;
        readonly needsBookmarkPush: boolean;
      },
      CliError,
      ProcessService
    >;
    readonly pushBookmarks: (bookmarkNames: ReadonlyArray<string>) => Effect.Effect<void, CliError, ProcessService>;
    readonly pushBookmark: (
      bookmarkName: string
    ) => Effect.Effect<void, CliError, ProcessService>;
  }
>() {}

const defaultRemoteState = {
  remoteBranchExists: false,
  needsBookmarkPush: true
} as const;

const parseRemoteState = (originLine: string | undefined) => ({
  remoteBranchExists: originLine !== undefined && !originLine.includes("(not created yet)"),
  needsBookmarkPush:
    originLine === undefined ||
    originLine.includes("(not created yet)") ||
    originLine.includes("(ahead by") ||
    originLine.includes("(behind by")
});

const make = {
  getBookmarksRemoteState: (bookmarkNames: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (bookmarkNames.length === 0) {
        return new Map();
      }

      const process = yield* ProcessService;
      const result = yield* process.run("jj", ["bookmark", "list", ...bookmarkNames, "--all-remotes"], {
        allowNonZeroExit: true
      });

      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          new CliError(`Failed to inspect remote state for bookmarks.\n${result.stderr || result.stdout}`)
        );
      }

      const remoteStates = new Map<
        string,
        {
          readonly remoteBranchExists: boolean;
          readonly needsBookmarkPush: boolean;
        }
      >();

      let currentBookmark: string | undefined;

      for (const line of result.stdout.split("\n")) {
        if (line.trim().length === 0) {
          continue;
        }

        if (!line.startsWith(" ") && !line.startsWith("\t")) {
          const [bookmarkName] = line.split(":");
          currentBookmark = bookmarkName?.trim();
          if (currentBookmark !== undefined && !remoteStates.has(currentBookmark)) {
            remoteStates.set(currentBookmark, defaultRemoteState);
          }
          continue;
        }

        const trimmed = line.trim();
        if (currentBookmark === undefined || !trimmed.startsWith("@origin")) {
          continue;
        }

        remoteStates.set(currentBookmark, parseRemoteState(trimmed));
      }

      for (const bookmarkName of bookmarkNames) {
        if (!remoteStates.has(bookmarkName)) {
          remoteStates.set(bookmarkName, defaultRemoteState);
        }
      }

      return remoteStates;
    }),

  getBookmarkRemoteState: (bookmarkName: string) =>
    Effect.gen(function* () {
      const remoteStates = yield* make.getBookmarksRemoteState([bookmarkName]);
      return remoteStates.get(bookmarkName) ?? defaultRemoteState;
    }),

  pushBookmarks: (bookmarkNames: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (bookmarkNames.length === 0) {
        return;
      }

      const process = yield* ProcessService;
      const args = ["git", "push", ...bookmarkNames.flatMap((bookmarkName) => ["--bookmark", bookmarkName])];
      yield* process.run("jj", args);
    }),

  pushBookmark: (bookmarkName: string) =>
    Effect.gen(function* () {
      yield* make.pushBookmarks([bookmarkName]);
    })
};

export const GitServiceLive = Layer.succeed(GitService, make);
