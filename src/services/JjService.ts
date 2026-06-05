import { Context, Effect, Layer } from "effect";

import { buildDiffArgs, type DiffFormat } from "../diff";
import type { BookmarkNode, StackEntry } from "../domain";
import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class JjService extends Context.Tag("JjService")<
  JjService,
  {
    readonly ensureAdvanceBookmarksEnabled: Effect.Effect<void, CliError, ProcessService>;
    readonly getCurrentStack: Effect.Effect<ReadonlyArray<StackEntry>, CliError, ProcessService>;
    readonly ensureBookmarkDescription: (
      bookmarkName: string,
      description: string
    ) => Effect.Effect<void, CliError, ProcessService>;
    readonly createBookmark: (options: {
      readonly bookmarkName: string;
      readonly message: string;
    }) => Effect.Effect<void, CliError, ProcessService>;
    readonly moveUp: Effect.Effect<string, CliError, ProcessService>;
    readonly moveDown: Effect.Effect<string, CliError, ProcessService>;
    readonly syncBookmarkToRemote: (bookmarkName: string) => Effect.Effect<void, CliError, ProcessService>;
    readonly startWorkingCopyOnBookmark: (options: {
      readonly bookmarkName: string;
      readonly message: string;
    }) => Effect.Effect<string, CliError, ProcessService>;
    readonly continueWorkingCopyOnStack: (options: {
      readonly rootBookmarkName: string;
      readonly tipBookmarkName: string;
      readonly defaultBranch: string;
      readonly message: string;
    }) => Effect.Effect<string, CliError, ProcessService>;
    readonly refreshToRemoteBookmark: (options: {
      readonly bookmarkName: string;
      readonly message: string;
    }) => Effect.Effect<string, CliError, ProcessService>;
    readonly diffCurrentStack: (options: {
      readonly defaultBranch: string;
      readonly against?: string;
      readonly format: DiffFormat;
    }) => Effect.Effect<string, CliError, ProcessService>;
  }
>() {}

const advanceBookmarksError = () =>
  new CliError(
    'jjacks requires `advance-bookmarks.enabled = true`.\n\nRun:\n  jj config set --user advance-bookmarks.enabled true'
  );

const ensureAdvanceBookmarksEnabled = Effect.gen(function* () {
  const process = yield* ProcessService;
  const result = yield* process.run("jj", ["config", "get", "advance-bookmarks.enabled"], {
    allowNonZeroExit: true
  });

  if (result.exitCode !== 0 || result.stdout.trim() !== "true") {
    return yield* Effect.fail(advanceBookmarksError());
  }
});

const deriveBranchName = (bookmarkName: string): string =>
  bookmarkName.replace(/[^A-Za-z0-9/_-]+/g, "-");

const parseTemplateLine = (line: string): BookmarkNode | null => {
  if (line.length === 0) {
    return null;
  }

  const [name, changeId, commitId, description, parentBookmarkName] = line.split("\t");
  if (name === undefined || changeId === undefined || commitId === undefined || description === undefined) {
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
    description,
    parentBookmarkName: resolvedParentBookmarkName
  };
};

const stackTemplate =
  `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ change_id.short() ++ "\t" ++ commit_id.short() ++ "\t" ++ ` +
  `description.first_line() ++ "\t" ++ ` +
  `parents.map(|p| p.bookmarks().map(|b| b.name()).join(",")).join("|") ++ "\n"`;

const orderStackNodes = (
  allNodes: ReadonlyArray<BookmarkNode>,
  currentPathNodes: ReadonlyArray<BookmarkNode>
): ReadonlyArray<BookmarkNode> => {
  if (currentPathNodes.length === 0) {
    return [];
  }

  const seen = new Set(currentPathNodes.map((node) => node.name));
  const childrenByParent = new Map<string, Array<BookmarkNode>>();

  for (const node of allNodes) {
    const parentBookmarkName = node.parentBookmarkName;
    if (parentBookmarkName === undefined) {
      continue;
    }

    const existing = childrenByParent.get(parentBookmarkName) ?? [];
    existing.push(node);
    childrenByParent.set(parentBookmarkName, existing);
  }

  const ordered = [...currentPathNodes];
  let cursor = currentPathNodes[currentPathNodes.length - 1];

  while (cursor !== undefined) {
    const unseenChildren = (childrenByParent.get(cursor.name) ?? []).filter((node) => !seen.has(node.name));
    if (unseenChildren.length !== 1) {
      break;
    }

    const [child] = unseenChildren;
    if (child === undefined) {
      break;
    }

    ordered.push(child);
    seen.add(child.name);
    cursor = child;
  }

  return ordered;
};

const make = {
  ensureAdvanceBookmarksEnabled,

  ensureBookmarkDescription: (bookmarkName: string, description: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* process.run("jj", ["describe", "-m", description, bookmarkName]);
    }),

  createBookmark: ({
    bookmarkName,
    message
  }: {
    readonly bookmarkName: string;
    readonly message: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;
      yield* process.run("jj", ["new", "-m", message]);
      yield* process.run("jj", ["bookmark", "create", bookmarkName]);
    }),

  moveUp: Effect.gen(function* () {
    const process = yield* ProcessService;
    yield* ensureAdvanceBookmarksEnabled;
    yield* process.run("jj", ["next"]);
    const summary = yield* process.run("jj", ["log", "-r", "@ | @-", "--no-graph"]);
    return summary.stdout;
  }),

  moveDown: Effect.gen(function* () {
    const process = yield* ProcessService;
    yield* ensureAdvanceBookmarksEnabled;
    yield* process.run("jj", ["prev"]);
    const summary = yield* process.run("jj", ["log", "-r", "@ | @-", "--no-graph"]);
    return summary.stdout;
  }),

  syncBookmarkToRemote: (bookmarkName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;
      yield* process.run("jj", ["bookmark", "set", bookmarkName, "-r", `${bookmarkName}@origin`]);
    }),

  startWorkingCopyOnBookmark: ({
    bookmarkName,
    message
  }: {
    readonly bookmarkName: string;
    readonly message: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;
      yield* process.run("jj", ["new", bookmarkName, "-m", message]);
      yield* process.run("jj", ["rebase", "-s", "@", "-d", bookmarkName]);
      const summary = yield* process.run("jj", ["log", "-r", "@ | @-", "--no-graph"]);
      return summary.stdout;
    }),

  continueWorkingCopyOnStack: ({
    rootBookmarkName,
    tipBookmarkName,
    defaultBranch,
    message
  }: {
    readonly rootBookmarkName: string;
    readonly tipBookmarkName: string;
    readonly defaultBranch: string;
    readonly message: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;
      yield* process.run("jj", ["rebase", "-s", rootBookmarkName, "-d", defaultBranch]);
      yield* process.run("jj", ["new", tipBookmarkName, "-m", message]);
      const summary = yield* process.run("jj", ["log", "-r", "@ | @- | @--", "--no-graph"]);
      return summary.stdout;
    }),

  refreshToRemoteBookmark: ({
    bookmarkName,
    message
  }: {
    readonly bookmarkName: string;
    readonly message: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;
      yield* process.run("jj", ["bookmark", "set", bookmarkName, "-r", `${bookmarkName}@origin`]);
      yield* process.run("jj", ["new", bookmarkName, "-m", message]);
      yield* process.run("jj", ["rebase", "-s", "@", "-d", bookmarkName]);
      const summary = yield* process.run("jj", ["log", "-r", "@ | @-", "--no-graph"]);
      return summary.stdout;
    }),

  diffCurrentStack: ({
    defaultBranch,
    against,
    format
  }: {
    readonly defaultBranch: string;
    readonly against?: string;
    readonly format: DiffFormat;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      const stack = yield* make.getCurrentStack;
      if (stack.length === 0) {
        return yield* Effect.fail(
          new CliError("No active bookmark stack found. Run `jjacks create <bookmark-name>` first.")
        );
      }
      const args = buildDiffArgs({
        stack,
        defaultBranch,
        ...(against === undefined ? {} : { against }),
        format
      });
      const result = yield* process.run("jj", args);
      return result.stdout;
    }),

  getCurrentStack: Effect.gen(function* () {
    const process = yield* ProcessService;
    yield* ensureAdvanceBookmarksEnabled;

    const [allBookmarks, currentPath] = yield* Effect.all([
      process.run("jj", ["log", "-r", "bookmarks() & ~::trunk()", "-T", stackTemplate, "--no-graph"], {
        allowNonZeroExit: true
      }),
      process.run("jj", ["log", "-r", "::@ & bookmarks() & ~::trunk()", "-T", stackTemplate, "--no-graph"], {
        allowNonZeroExit: true
      })
    ]);

    if (allBookmarks.exitCode !== 0 || currentPath.exitCode !== 0) {
      const failingResult = allBookmarks.exitCode !== 0 ? allBookmarks : currentPath;

      if (failingResult.stderr.includes("There is no jj repo")) {
        return yield* Effect.fail(
          new CliError('This directory is a Git repo but not a jj repo yet. Run "jj git init" here first, then rerun jjacks.')
        );
      }

      return yield* Effect.fail(
        new CliError(
          [`Failed to inspect the current jj stack.`, failingResult.stderr, failingResult.stdout]
            .filter(Boolean)
            .join("\n")
        )
      );
    }

    const parseNodes = (stdout: string) =>
      stdout
        .split("\n")
        .map((line) => parseTemplateLine(line))
        .filter((node): node is BookmarkNode => node !== null)
        .map((node) => node);

    const nodes = parseNodes(allBookmarks.stdout);
    const currentPathNodes = [...parseNodes(currentPath.stdout)].reverse();
    const currentBookmarkName = currentPathNodes[currentPathNodes.length - 1]?.name;
    const ordered = orderStackNodes(nodes, currentPathNodes).map((node) => ({
      ...node,
      branchName: deriveBranchName(node.name),
      isCurrent: node.name === currentBookmarkName
    }));

    return ordered;
  })
};

export const JjServiceLive = Layer.effect(JjService, Effect.succeed(make));
export { orderStackNodes };
