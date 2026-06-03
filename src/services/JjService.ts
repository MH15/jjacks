import { Context, Effect, Layer } from "effect";

import type { BookmarkNode, StackEntry } from "../domain";
import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class JjService extends Context.Tag("JjService")<
  JjService,
  {
    readonly ensureAdvanceBookmarksEnabled: Effect.Effect<void, CliError, ProcessService>;
    readonly getCurrentStack: Effect.Effect<ReadonlyArray<StackEntry>, CliError, ProcessService>;
  }
>() {}

const advanceBookmarksError = () =>
  new CliError(
    'jjacks requires `advance-bookmarks.enabled = true`.\n\nRun:\n  jj config set --user advance-bookmarks.enabled true'
  );

const deriveBranchName = (bookmarkName: string): string =>
  bookmarkName.replace(/[^A-Za-z0-9/_-]+/g, "-");

const parseTemplateLine = (line: string): BookmarkNode | null => {
  if (line.length === 0) {
    return null;
  }

  const [name, changeId, commitId, parentBookmarkName] = line.split("\t");
  if (name === undefined || changeId === undefined || commitId === undefined) {
    return null;
  }

  const resolvedParentBookmarkName =
    parentBookmarkName
      ?.split("|")
      .flatMap((segment) => segment.split(","))
      .find((segment) => segment.length > 0) ?? undefined;

  return {
    name,
    changeId,
    commitId,
    parentBookmarkName: resolvedParentBookmarkName
  };
};

const make = {
  ensureAdvanceBookmarksEnabled: Effect.gen(function* () {
    const process = yield* ProcessService;
    const result = yield* process.run("jj", ["config", "get", "advance-bookmarks.enabled"], {
      allowNonZeroExit: true
    });

    if (result.exitCode !== 0 || result.stdout.trim() !== "true") {
      return yield* Effect.fail(advanceBookmarksError());
    }
  }),

  getCurrentStack: Effect.gen(function* () {
    const process = yield* ProcessService;
    yield* make.ensureAdvanceBookmarksEnabled;
    const template =
      `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ change_id.short() ++ "\t" ++ commit_id.short() ++ "\t" ++ ` +
      `parents.map(|p| p.bookmarks().map(|b| b.name()).join(",")).join("|") ++ "\n"`;

    const current = yield* process.run(
      "jj",
      ["log", "-r", "::@ & bookmarks() & ~::trunk()", "-T", template, "--no-graph"],
      {
        allowNonZeroExit: true
      }
    );

    if (current.exitCode !== 0) {
      if (current.stderr.includes("There is no jj repo")) {
        return yield* Effect.fail(
          new CliError('This directory is a Git repo but not a jj repo yet. Run "jj git init" here first, then rerun jjacks.')
        );
      }

      return yield* Effect.fail(
        new CliError(
          [`Failed to inspect the current jj stack.`, current.stderr, current.stdout].filter(Boolean).join("\n")
        )
      );
    }
    const nodes = current.stdout
      .split("\n")
      .map((line) => parseTemplateLine(line))
      .filter((node): node is BookmarkNode => node !== null)
      .map((node) => node);

    if (nodes.length === 0) {
      return yield* Effect.fail(new CliError("No bookmarks found in the current stack."));
    }

    const ordered = [...nodes].reverse().map((node) => ({
      ...node,
      branchName: deriveBranchName(node.name)
    }));

    return ordered;
  })
};

export const JjServiceLive = Layer.effect(JjService, Effect.succeed(make));
