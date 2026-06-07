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
    readonly getTrackedBookmarks: Effect.Effect<ReadonlyArray<StackEntry>, CliError, ProcessService>;
    readonly ensureBookmarkDescription: (
      bookmarkName: string,
      description: string
    ) => Effect.Effect<void, CliError, ProcessService>;
    readonly createBookmark: (options: {
      readonly bookmarkName: string;
      readonly message: string;
    }) => Effect.Effect<void, CliError, ProcessService>;
    readonly moveToBookmark: (bookmarkName: string) => Effect.Effect<string, CliError, ProcessService>;
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
    readonly logBookmarks: (options: {
      readonly mode: "tree" | "active" | "bookmarks-only";
      readonly noGraph: boolean;
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

const parseTemplateLine = (line: string): (BookmarkNode & { readonly isEmpty: boolean }) | null => {
  if (line.length === 0) {
    return null;
  }

  const [name, changeId, commitId, description, empty, parentBookmarkName] = line.split("\t");
  if (
    name === undefined ||
    changeId === undefined ||
    commitId === undefined ||
    description === undefined ||
    empty === undefined
  ) {
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
    parentBookmarkName: resolvedParentBookmarkName,
    isEmpty: empty === "true"
  };
};

const stackTemplate =
  `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ change_id.short() ++ "\t" ++ commit_id.short() ++ "\t" ++ ` +
  `description.first_line() ++ "\t" ++ empty ++ "\t" ++ ` +
  `parents.map(|p| p.bookmarks().map(|b| b.name()).join(",")).join("|") ++ "\n"`;

type ParsedStackNode = NonNullable<ReturnType<typeof parseTemplateLine>>;

type DescendantNode = {
  readonly bookmarkNames: ReadonlyArray<string>;
  readonly changeId: string;
  readonly commitId: string;
  readonly description: string;
  readonly isEmpty: boolean;
  readonly parentChangeIds: ReadonlyArray<string>;
};

const descendantTemplate =
  `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ change_id.short() ++ "\t" ++ commit_id.short() ++ "\t" ++ ` +
  `description.first_line() ++ "\t" ++ empty ++ "\t" ++ parents.map(|p| p.change_id().short()).join(",") ++ "\n"`;

const parseDescendantLine = (line: string): DescendantNode | null => {
  if (line.length === 0) {
    return null;
  }

  const [bookmarkNames, changeId, commitId, description, empty, parentChangeIds] = line.split("\t");
  if (
    bookmarkNames === undefined ||
    changeId === undefined ||
    commitId === undefined ||
    description === undefined ||
    empty === undefined
  ) {
    return null;
  }

  return {
    bookmarkNames: bookmarkNames.length === 0 ? [] : bookmarkNames.split(",").filter((name) => name.length > 0),
    changeId,
    commitId,
    description,
    isEmpty: empty === "true",
    parentChangeIds: parentChangeIds === undefined || parentChangeIds.length === 0
      ? []
      : parentChangeIds.split(",").filter((id) => id.length > 0)
  };
};

const workingCopyStateTemplate = `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ description.first_line() ++ "\n"`;

const parseWorkingCopyStateLine = (line: string): { readonly bookmarks: ReadonlyArray<string>; readonly description: string } | null => {
  if (line.length === 0) {
    return null;
  }

  const [bookmarks, description] = line.split("\t");
  if (bookmarks === undefined || description === undefined) {
    return null;
  }

  return {
    bookmarks: bookmarks.length === 0 ? [] : bookmarks.split(",").filter((bookmark) => bookmark.length > 0),
    description
  };
};

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

const orderTrackedBookmarks = (
  entries: ReadonlyArray<StackEntry>,
  currentBookmarkName: string | undefined
): ReadonlyArray<StackEntry> => {
  if (entries.length === 0) {
    return [];
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry] as const));
  const childrenByParent = new Map<string | undefined, Array<StackEntry>>();
  for (const entry of entries) {
    const existing = childrenByParent.get(entry.parentBookmarkName) ?? [];
    existing.push(entry);
    childrenByParent.set(entry.parentBookmarkName, existing);
  }

  const subtreeHasCurrent = new Map<string, boolean>();
  const hasCurrentInSubtree = (entry: StackEntry): boolean => {
    const cached = subtreeHasCurrent.get(entry.name);
    if (cached !== undefined) {
      return cached;
    }

    const result =
      entry.name === currentBookmarkName ||
      (childrenByParent.get(entry.name) ?? []).some((child) => hasCurrentInSubtree(child));
    subtreeHasCurrent.set(entry.name, result);
    return result;
  };

  const sortEntries = (items: ReadonlyArray<StackEntry>): Array<StackEntry> =>
    [...items].sort((left, right) => {
      const leftCurrent = hasCurrentInSubtree(left);
      const rightCurrent = hasCurrentInSubtree(right);
      if (leftCurrent !== rightCurrent) {
        return leftCurrent ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });

  const roots = sortEntries(
    entries.filter((entry) => entry.parentBookmarkName === undefined || !byName.has(entry.parentBookmarkName))
  );
  const ordered: Array<StackEntry> = [];

  const visit = (entry: StackEntry): void => {
    ordered.push(entry);
    for (const child of sortEntries(childrenByParent.get(entry.name) ?? [])) {
      visit(child);
    }
  };

  for (const root of roots) {
    visit(root);
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

  moveToBookmark: (bookmarkName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;
      yield* process.run("jj", ["edit", bookmarkName]);
      const summary = yield* process.run("jj", ["log", "-r", "@ | @-", "--no-graph"]);
      return summary.stdout;
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
      const workingCopyState = yield* process.run("jj", ["log", "-r", "@ | @-", "-T", workingCopyStateTemplate, "--no-graph"]);
      const [currentState, parentState] = workingCopyState.stdout
        .split("\n")
        .map((line) => parseWorkingCopyStateLine(line))
        .filter((state): state is NonNullable<typeof state> => state !== null);

      const alreadyContinuing =
        currentState !== undefined &&
        parentState !== undefined &&
        currentState.bookmarks.length === 0 &&
        currentState.description === message &&
        parentState.bookmarks.includes(tipBookmarkName);

      if (!alreadyContinuing) {
        yield* process.run("jj", ["new", tipBookmarkName, "-m", message]);
      }

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

  logBookmarks: ({
    mode,
    noGraph
  }: {
    readonly mode: "tree" | "active" | "bookmarks-only";
    readonly noGraph: boolean;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;

      const revset =
        mode === "active"
          ? "trunk()..@"
          : mode === "bookmarks-only"
            ? "descendants(trunk()) & ::bookmarks() & ~trunk()"
            : '(bookmarks() & descendants(main@origin) & ~main@origin) | main@origin';

      const args = ["log", "-r", revset] as Array<string>;
      if (noGraph) {
        args.push("--no-graph");
      }

      const result = yield* process.run("jj", args);
      return result.stdout;
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

  getTrackedBookmarks: Effect.gen(function* () {
    const process = yield* ProcessService;
    yield* ensureAdvanceBookmarksEnabled;

    const [descendants, currentPath] = yield* Effect.all([
      process.run("jj", ["log", "-r", "descendants(trunk()) & ~trunk()", "-T", descendantTemplate, "--no-graph"], {
        allowNonZeroExit: true
      }),
      process.run("jj", ["log", "-r", "::@ & descendants(trunk())", "-T", descendantTemplate, "--no-graph"], {
        allowNonZeroExit: true
      })
    ]);

    if (descendants.exitCode !== 0 || currentPath.exitCode !== 0) {
      const failingResult = descendants.exitCode !== 0 ? descendants : currentPath;

      if (failingResult.stderr.includes("There is no jj repo")) {
        return yield* Effect.fail(
          new CliError('This directory is a Git repo but not a jj repo yet. Run "jj git init" here first, then rerun jjacks.')
        );
      }

      return yield* Effect.fail(
        new CliError(
          [`Failed to inspect tracked jj bookmarks.`, failingResult.stderr, failingResult.stdout]
            .filter(Boolean)
            .join("\n")
        )
      );
    }

    const parseDescendants = (stdout: string) =>
      stdout
        .split("\n")
        .map((line) => parseDescendantLine(line))
        .filter((node): node is NonNullable<typeof node> => node !== null);

    const descendantNodes = parseDescendants(descendants.stdout);
    const descendantByChangeId = new Map(descendantNodes.map((node) => [node.changeId, node] as const));
    const bookmarkNameByChangeId = new Map(
      descendantNodes
        .filter((node) => node.bookmarkNames.length > 0)
        .map((node) => [node.changeId, node.bookmarkNames[0]!] as const)
    );

    const nearestBookmarkedAncestor = new Map<string, string | undefined>();
    const resolveNearestBookmarkedAncestor = (changeId: string): string | undefined => {
      if (nearestBookmarkedAncestor.has(changeId)) {
        return nearestBookmarkedAncestor.get(changeId);
      }

      const node = descendantByChangeId.get(changeId);
      if (node === undefined) {
        nearestBookmarkedAncestor.set(changeId, undefined);
        return undefined;
      }

      for (const parentChangeId of node.parentChangeIds) {
        const parentBookmark = bookmarkNameByChangeId.get(parentChangeId);
        if (parentBookmark !== undefined) {
          nearestBookmarkedAncestor.set(changeId, parentBookmark);
          return parentBookmark;
        }

        const ancestorBookmark = resolveNearestBookmarkedAncestor(parentChangeId);
        if (ancestorBookmark !== undefined) {
          nearestBookmarkedAncestor.set(changeId, ancestorBookmark);
          return ancestorBookmark;
        }
      }

      nearestBookmarkedAncestor.set(changeId, undefined);
      return undefined;
    };

    const currentBookmarkName = parseDescendants(currentPath.stdout)
      .find((node) => node.bookmarkNames.length > 0)
      ?.bookmarkNames[0];

    const trackedBookmarks = descendantNodes
      .filter((node) => node.bookmarkNames.length > 0)
      .map((node): StackEntry => ({
        name: node.bookmarkNames[0]!,
        changeId: node.changeId,
        commitId: node.commitId,
        description: node.description,
        parentBookmarkName: resolveNearestBookmarkedAncestor(node.changeId),
        branchName: deriveBranchName(node.bookmarkNames[0]!),
        isCurrent: node.bookmarkNames[0] === currentBookmarkName,
        isEmpty: node.isEmpty
      }));

    return orderTrackedBookmarks(trackedBookmarks, currentBookmarkName);
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
        .filter((node): node is ParsedStackNode => node !== null)
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
