import { Context, Effect, Layer, ParseResult, Schema } from "effect";

import { buildDiffArgs, type DiffFormat } from "../diff";
import { BookmarkNode, StackEntry, type BookmarkNode as BookmarkNodeType, type StackEntry as StackEntryType } from "../domain";
import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class JjService extends Context.Tag("JjService")<
  JjService,
  {
    readonly ensureAdvanceBookmarksEnabled: Effect.Effect<void, CliError, ProcessService>;
    readonly getStackCommentLocation: Effect.Effect<"comment" | "description", CliError, ProcessService>;
    readonly getCurrentStack: Effect.Effect<ReadonlyArray<StackEntryType>, CliError, ProcessService>;
    readonly getCurrentTree: Effect.Effect<ReadonlyArray<StackEntryType>, CliError, ProcessService>;
    readonly getTrackedBookmarks: Effect.Effect<ReadonlyArray<StackEntryType>, CliError, ProcessService>;
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
    readonly editWorkingCopyOnStack: (options: {
      readonly rootBookmarkName: string;
      readonly currentBookmarkName: string;
      readonly defaultBranch: string;
    }) => Effect.Effect<string, CliError, ProcessService>;
    readonly editWorkingCopyOnBookmark: (options: {
      readonly bookmarkName: string;
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

const decodeWithSchema = <A, I>(schema: Schema.Schema<A, I>, value: unknown, context: string) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError((error) =>
      new CliError(`${context}\n${ParseResult.TreeFormatter.formatErrorSync(error)}`)
    )
  );

const decodeUnknownNullable = <A, I>(schema: Schema.Schema<A, I>, value: unknown): A | null => {
  const decoded = Schema.decodeUnknownEither(schema)(value);
  return decoded._tag === "Right" ? decoded.right : null;
};

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

const getStackCommentLocation = Effect.gen(function* () {
  const process = yield* ProcessService;
  const result = yield* process.run("jj", ["config", "get", "jjacks.stack_comments.location"], {
    allowNonZeroExit: true
  });

  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    return "comment" as const;
  }

  const value = result.stdout.trim();
  if (value === "comment" || value === "description") {
    return value;
  }

  return yield* Effect.fail(
    new CliError(
      `Unsupported value for jjacks.stack_comments.location: ${value}\nExpected one of: comment, description`
    )
  );
});

const deriveBranchName = (bookmarkName: string): string =>
  bookmarkName.replace(/[^A-Za-z0-9/_-]+/g, "-");

const ParsedStackNode = Schema.Struct({
  ...BookmarkNode.fields,
  isEmpty: Schema.Boolean
}).annotations({ identifier: "ParsedStackNode" });
type ParsedStackNode = Schema.Schema.Type<typeof ParsedStackNode>;

const DescendantNode = Schema.Struct({
  bookmarkNames: Schema.Array(Schema.String),
  changeId: Schema.String,
  commitId: Schema.String,
  description: Schema.String,
  isEmpty: Schema.Boolean,
  hasConflict: Schema.Boolean,
  parentChangeIds: Schema.Array(Schema.String)
}).annotations({ identifier: "DescendantNode" });
type DescendantNode = Schema.Schema.Type<typeof DescendantNode>;

const WorkingCopyState = Schema.Struct({
  bookmarks: Schema.Array(Schema.String),
  description: Schema.String
}).annotations({ identifier: "WorkingCopyState" });
type WorkingCopyState = Schema.Schema.Type<typeof WorkingCopyState>;

const parseTemplateLine = (line: string): ParsedStackNode | null => {
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

  return decodeUnknownNullable(ParsedStackNode, {
    name,
    changeId,
    commitId,
    description,
    ...(resolvedParentBookmarkName === undefined ? {} : { parentBookmarkName: resolvedParentBookmarkName }),
    isEmpty: empty === "true"
  });
};

const stackTemplate =
  `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ change_id.short() ++ "\t" ++ commit_id.short() ++ "\t" ++ ` +
  `description.first_line() ++ "\t" ++ empty ++ "\t" ++ ` +
  `parents.map(|p| p.bookmarks().map(|b| b.name()).join(",")).join("|") ++ "\n"`;
const descendantTemplate =
  `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ change_id.short() ++ "\t" ++ commit_id.short() ++ "\t" ++ ` +
  `description.first_line() ++ "\t" ++ empty ++ "\t" ++ conflict ++ "\t" ++ parents.map(|p| p.change_id().short()).join(",") ++ "\n"`;
const trackedBookmarksRevset = "(::(bookmarks() & ~::trunk())) & ~::trunk()";

const parseDescendantLine = (line: string): DescendantNode | null => {
  if (line.length === 0) {
    return null;
  }

  const [bookmarkNames, changeId, commitId, description, empty, conflict, parentChangeIds] = line.split("\t");
  if (
    bookmarkNames === undefined ||
    changeId === undefined ||
    commitId === undefined ||
    description === undefined ||
    empty === undefined ||
    conflict === undefined
  ) {
    return null;
  }

  return decodeUnknownNullable(DescendantNode, {
    bookmarkNames: bookmarkNames.length === 0 ? [] : bookmarkNames.split(",").filter((name) => name.length > 0),
    changeId,
    commitId,
    description,
    isEmpty: empty === "true",
    hasConflict: conflict === "true",
    parentChangeIds: parentChangeIds === undefined || parentChangeIds.length === 0
      ? []
      : parentChangeIds.split(",").filter((id) => id.length > 0)
  });
};

const workingCopyStateTemplate = `bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ description.first_line() ++ "\n"`;

const parseWorkingCopyStateLine = (line: string): WorkingCopyState | null => {
  if (line.length === 0) {
    return null;
  }

  const [bookmarks, description] = line.split("\t");
  if (bookmarks === undefined || description === undefined) {
    return null;
  }

  return decodeUnknownNullable(WorkingCopyState, {
    bookmarks: bookmarks.length === 0 ? [] : bookmarks.split(",").filter((bookmark) => bookmark.length > 0),
    description
  });
};

const createBookmarkStateTemplate =
  `change_id.short() ++ "\t" ++ bookmarks.map(|b| b.name()).join(",") ++ "\t" ++ description.first_line() ++ "\t" ++ "jjacks" ++ "\n"`;

const parseCreateBookmarkStateLine = (line: string): WorkingCopyState | null => {
  if (line.length === 0) {
    return null;
  }

  const [changeId, bookmarks, description, marker] = line.split("\t");
  if (changeId === undefined || bookmarks === undefined || description === undefined || marker !== "jjacks") {
    return null;
  }

  return decodeUnknownNullable(WorkingCopyState, {
    bookmarks: bookmarks.length === 0 ? [] : bookmarks.split(",").filter((bookmark) => bookmark.length > 0),
    description
  });
};

const orderStackNodes = (
  allNodes: ReadonlyArray<BookmarkNodeType>,
  currentPathNodes: ReadonlyArray<BookmarkNodeType>
): ReadonlyArray<BookmarkNodeType> => {
  if (currentPathNodes.length === 0) {
    return [];
  }

  const seen = new Set(currentPathNodes.map((node) => node.name));
  const childrenByParent = new Map<string, Array<BookmarkNodeType>>();

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
  entries: ReadonlyArray<StackEntryType>,
  currentBookmarkName: string | undefined
): ReadonlyArray<StackEntryType> => {
  if (entries.length === 0) {
    return [];
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry] as const));
  const childrenByParent = new Map<string | undefined, Array<StackEntryType>>();
  for (const entry of entries) {
    const existing = childrenByParent.get(entry.parentBookmarkName) ?? [];
    existing.push(entry);
    childrenByParent.set(entry.parentBookmarkName, existing);
  }

  const subtreeHasCurrent = new Map<string, boolean>();
  const hasCurrentInSubtree = (entry: StackEntryType): boolean => {
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

  const sortEntries = (items: ReadonlyArray<StackEntryType>): Array<StackEntryType> =>
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
  const ordered: Array<StackEntryType> = [];

  const visit = (entry: StackEntryType): void => {
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

const selectCurrentBookmarkTree = (
  entries: ReadonlyArray<StackEntryType>,
  currentBookmarkName: string | undefined
): ReadonlyArray<StackEntryType> => {
  if (entries.length === 0 || currentBookmarkName === undefined) {
    return [];
  }

  const byName = new Map(entries.map((entry) => [entry.name, entry] as const));
  let rootEntry = byName.get(currentBookmarkName);
  if (rootEntry === undefined) {
    return [];
  }

  while (rootEntry.parentBookmarkName !== undefined) {
    const parentEntry = byName.get(rootEntry.parentBookmarkName);
    if (parentEntry === undefined) {
      break;
    }
    rootEntry = parentEntry;
  }

  const childrenByParent = new Map<string, Array<StackEntryType>>();
  for (const entry of entries) {
    const parentBookmarkName = entry.parentBookmarkName;
    if (parentBookmarkName === undefined) {
      continue;
    }

    const existing = childrenByParent.get(parentBookmarkName) ?? [];
    existing.push(entry);
    childrenByParent.set(parentBookmarkName, existing);
  }

  const subtreeNames = new Set<string>();
  const visit = (entryName: string): void => {
    if (subtreeNames.has(entryName)) {
      return;
    }

    subtreeNames.add(entryName);
    for (const child of childrenByParent.get(entryName) ?? []) {
      visit(child.name);
    }
  };

  visit(rootEntry.name);

  return orderTrackedBookmarks(
    entries.filter((entry) => subtreeNames.has(entry.name)),
    currentBookmarkName
  );
};

const getTrackedBookmarks = Effect.gen(function* () {
  const process = yield* ProcessService;
  yield* ensureAdvanceBookmarksEnabled;

  const [descendants, currentPath] = yield* Effect.all([
    process.run("jj", ["log", "-r", trackedBookmarksRevset, "-T", descendantTemplate, "--no-graph"], {
      allowNonZeroExit: true
    }),
    process.run("jj", ["log", "-r", `::@ & ${trackedBookmarksRevset}`, "-T", descendantTemplate, "--no-graph"], {
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

  const trackedBookmarks = yield* Effect.forEach(
    descendantNodes.filter((node) => node.bookmarkNames.length > 0),
    (node) =>
      decodeWithSchema(StackEntry, {
        name: node.bookmarkNames[0]!,
        changeId: node.changeId,
        commitId: node.commitId,
        description: node.description,
        ...(resolveNearestBookmarkedAncestor(node.changeId) === undefined
          ? {}
          : { parentBookmarkName: resolveNearestBookmarkedAncestor(node.changeId) }),
        branchName: deriveBranchName(node.bookmarkNames[0]!),
        isCurrent: node.bookmarkNames[0] === currentBookmarkName,
        isEmpty: node.isEmpty,
        hasConflict: node.hasConflict
      }, `Failed to decode tracked bookmark ${node.bookmarkNames[0]!}`)
  );

  return orderTrackedBookmarks(trackedBookmarks, currentBookmarkName);
});

const getCurrentTree = Effect.gen(function* () {
  const trackedBookmarks = yield* getTrackedBookmarks;
  const currentBookmarkName = trackedBookmarks.find((entry) => entry.isCurrent)?.name;
  return selectCurrentBookmarkTree(trackedBookmarks, currentBookmarkName);
});

const buildCurrentTreeRevset = (
  entries: ReadonlyArray<StackEntryType>
): string | undefined => {
  const rootEntry = entries[0];
  return rootEntry === undefined ? undefined : `descendants(change_id("${rootEntry.changeId}"))`;
};

const make = {
  ensureAdvanceBookmarksEnabled,
  getStackCommentLocation,
  getTrackedBookmarks,
  getCurrentTree,

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
      const workingCopyState = yield* process.run("jj", ["log", "-r", "@", "-T", createBookmarkStateTemplate, "--no-graph"]);
      const currentState = parseCreateBookmarkStateLine(workingCopyState.stdout);

      if (currentState?.bookmarks.length !== 0) {
        yield* process.run("jj", ["new", "-m", message]);
      }

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

  editWorkingCopyOnStack: ({
    rootBookmarkName,
    currentBookmarkName,
    defaultBranch
  }: {
    readonly rootBookmarkName: string;
    readonly currentBookmarkName: string;
    readonly defaultBranch: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;
      yield* process.run("jj", ["rebase", "-s", rootBookmarkName, "-d", defaultBranch]);
      yield* process.run("jj", ["edit", currentBookmarkName]);
      const summary = yield* process.run("jj", ["log", "-r", "@ | @-", "--no-graph"]);
      return summary.stdout;
    }),

  editWorkingCopyOnBookmark: ({
    bookmarkName
  }: {
    readonly bookmarkName: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* ensureAdvanceBookmarksEnabled;
      yield* process.run("jj", ["edit", bookmarkName]);
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
      const currentTree = yield* getCurrentTree;
      const currentTreeRevset = buildCurrentTreeRevset(currentTree);

      const revset =
        mode === "active"
          ? "trunk()..@"
          : mode === "bookmarks-only"
            ? currentTreeRevset === undefined
              ? undefined
              : `bookmarks() & ${currentTreeRevset} & ~trunk()`
            : currentTreeRevset === undefined
              ? "trunk()"
              : `trunk() | ${currentTreeRevset}`;

      if (revset === undefined) {
        return "";
      }

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
    const ordered = yield* Effect.forEach(
      orderStackNodes(nodes, currentPathNodes),
      (node) =>
        decodeWithSchema(StackEntry, {
          ...node,
          branchName: deriveBranchName(node.name),
          isCurrent: node.name === currentBookmarkName
        }, `Failed to decode stack entry ${node.name}`)
    );

    return ordered;
  })
};

export const JjServiceLive = Layer.succeed(JjService, make);
export { orderStackNodes, selectCurrentBookmarkTree };
