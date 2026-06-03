import { Context, Effect, Layer } from "effect";

import type { BookmarkNode, StackEntry } from "../domain.js";
import { CliError } from "../errors.js";
import { ProcessService } from "./ProcessService.js";

export class JjService extends Context.Tag("JjService")<
  JjService,
  {
    readonly getCurrentStack: Effect.Effect<ReadonlyArray<StackEntry>, CliError, ProcessService>;
  }
>() {}

const BRANCH_PREFIX = "jj/";

const deriveBranchName = (bookmarkName: string): string =>
  `${BRANCH_PREFIX}${bookmarkName.replace(/[^A-Za-z0-9/_-]+/g, "-")}`;

const parseTemplateLine = (line: string): BookmarkNode | null => {
  if (line.length === 0) {
    return null;
  }

  const [name, changeId, commitId, parentBookmarkName] = line.split("\t");
  if (name === undefined || changeId === undefined || commitId === undefined) {
    return null;
  }

  return {
    name,
    changeId,
    commitId,
    parentBookmarkName: parentBookmarkName || undefined
  };
};

const make = {
  getCurrentStack: Effect.gen(function* () {
    const process = yield* ProcessService;
    const template =
      `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ change_id.short() ++ "\t" ++ commit_id.short() ++ "\t" ++ ` +
      `parents.map(|p| p.bookmarks().map(|b| b.name()).join(",")).filter(|n| n != "").join(",") ++ "\n"`;

    const current = yield* process.run("jj", ["log", "-r", "::@ & bookmarks()", "-T", template], {
      allowNonZeroExit: true
    });

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
      .map((node) => ({
        ...node,
        parentBookmarkName: node.parentBookmarkName?.split(",")[0]
      }));

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
