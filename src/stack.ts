import type {
  PullRequestSummary,
  StackEntry,
  StackStatusEntry,
  SyncPlan,
  SyncPlanEntry,
  SyncPlanInfoEntry,
} from "./domain";

const STACK_COMMENT_MARKER = "<!-- jjacks:stack -->";
const STACK_COMMENT_END_MARKER = "<!-- /jjacks:stack -->";

export type ReviewStackClassification =
  | "syncable"
  | "landed"
  | "closed"
  | "blocked"
  | "placeholder";

export type ClassifiedReviewStackEntry = StackStatusEntry & {
  readonly classification: ReviewStackClassification;
  readonly intendedBaseBranch: string;
};

export type ReviewStackAnalysis = {
  readonly entries: ReadonlyArray<ClassifiedReviewStackEntry>;
  readonly syncableEntries: ReadonlyArray<ClassifiedReviewStackEntry>;
  readonly landedEntries: ReadonlyArray<ClassifiedReviewStackEntry>;
  readonly closedEntries: ReadonlyArray<ClassifiedReviewStackEntry>;
  readonly blockedEntries: ReadonlyArray<ClassifiedReviewStackEntry>;
  readonly placeholderEntries: ReadonlyArray<ClassifiedReviewStackEntry>;
  readonly rootSyncableEntry: ClassifiedReviewStackEntry | undefined;
  readonly currentSyncableEntry: ClassifiedReviewStackEntry | undefined;
  readonly localActions: ReadonlyArray<string>;
  readonly completionState: SyncPlan["completionState"];
};

export const isPullRequestOpen = (pullRequest: PullRequestSummary): boolean =>
  pullRequest.state === undefined || pullRequest.state === "OPEN";

const classifyStatusEntry = (entry: StackStatusEntry): ReviewStackClassification => {
  if (entry.blockedBy !== undefined) {
    return "blocked";
  }

  if (entry.entry.isEmpty === true && entry.pullRequest === null) {
    return "placeholder";
  }

  if (entry.pullRequest?.state === "MERGED") {
    return "landed";
  }

  if (entry.pullRequest !== null && !isPullRequestOpen(entry.pullRequest)) {
    return "closed";
  }

  return "syncable";
};

const buildClassifiedEntries = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string,
): ReadonlyArray<ClassifiedReviewStackEntry> => {
  const entriesByName = new Map<string, ClassifiedReviewStackEntry>();
  const rawEntriesByName = new Map(entries.map((entry) => [entry.entry.name, entry] as const));

  const classify = (entry: StackStatusEntry): ClassifiedReviewStackEntry => {
    const existing = entriesByName.get(entry.entry.name);
    if (existing !== undefined) {
      return existing;
    }

    let parentEntry =
      entry.entry.parentBookmarkName === undefined
        ? undefined
        : rawEntriesByName.get(entry.entry.parentBookmarkName);
    let intendedBaseBranch = defaultBranch;

    while (parentEntry !== undefined) {
      const parent = classify(parentEntry);
      if (parent.classification === "syncable") {
        intendedBaseBranch = parent.entry.branchName;
        break;
      }

      parentEntry =
        parent.entry.parentBookmarkName === undefined
          ? undefined
          : rawEntriesByName.get(parent.entry.parentBookmarkName);
    }

    const classified = {
      ...entry,
      classification: classifyStatusEntry(entry),
      intendedBaseBranch,
    } satisfies ClassifiedReviewStackEntry;
    entriesByName.set(entry.entry.name, classified);
    return classified;
  };

  return entries.map(classify);
};

const buildLocalActions = (
  syncableEntries: ReadonlyArray<ClassifiedReviewStackEntry>,
  completionState: SyncPlan["completionState"],
  defaultBranch: string,
): ReadonlyArray<string> => {
  if (completionState === "empty") {
    return [];
  }

  const currentSyncableEntry =
    syncableEntries.find((entry) => entry.entry.isCurrent) ??
    syncableEntries[syncableEntries.length - 1];
  const rootSyncableEntry = syncableEntries[0];

  return [
    "fetch origin",
    `move ${defaultBranch} to ${defaultBranch}@origin`,
    ...(completionState === "stack-complete"
      ? [`edit ${defaultBranch}`]
      : rootSyncableEntry === undefined || currentSyncableEntry === undefined
        ? []
        : [
            `rebase ${rootSyncableEntry.entry.name} onto ${rootSyncableEntry.intendedBaseBranch}`,
            `edit ${currentSyncableEntry.entry.name}`,
          ]),
  ];
};

export const analyzeReviewStack = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string,
): ReviewStackAnalysis => {
  const classifiedEntries = buildClassifiedEntries(entries, defaultBranch);
  const syncableEntries = classifiedEntries.filter((entry) => entry.classification === "syncable");
  const landedEntries = classifiedEntries.filter((entry) => entry.classification === "landed");
  const closedEntries = classifiedEntries.filter((entry) => entry.classification === "closed");
  const blockedEntries = classifiedEntries.filter((entry) => entry.classification === "blocked");
  const placeholderEntries = classifiedEntries.filter(
    (entry) => entry.classification === "placeholder",
  );
  const completionState =
    entries.length === 0
      ? "empty"
      : syncableEntries.length === 0
        ? "stack-complete"
        : "active-stack";
  const localActions = buildLocalActions(syncableEntries, completionState, defaultBranch);

  return {
    entries: classifiedEntries,
    syncableEntries,
    landedEntries,
    closedEntries,
    blockedEntries,
    placeholderEntries,
    rootSyncableEntry: syncableEntries[0],
    currentSyncableEntry:
      syncableEntries.find((entry) => entry.entry.isCurrent) ??
      syncableEntries[syncableEntries.length - 1],
    localActions,
    completionState,
  };
};

const buildGithubPlanActions = (
  entry: StackEntry,
  pullRequest: PullRequestSummary | null,
  intendedBaseBranch: string,
  _remoteBranchExists: boolean,
  needsBookmarkPush: boolean,
): ReadonlyArray<string> => [
  ...(entry.description.trim().length === 0
    ? [`set jj change description to "${entry.name}"`]
    : []),
  ...(needsBookmarkPush ? ["push bookmark"] : []),
  ...(pullRequest === null ? [`create PR with base ${intendedBaseBranch}`] : []),
  ...(pullRequest !== null && pullRequest.title !== entry.name
    ? [`rename PR #${pullRequest.number} to "${entry.name}"`]
    : []),
  ...(pullRequest !== null && pullRequest.baseRefName !== intendedBaseBranch
    ? [
        `retarget PR #${pullRequest.number} base from ${pullRequest.baseRefName} to ${intendedBaseBranch}`,
      ]
    : []),
];

const toInfoEntry = (entry: ClassifiedReviewStackEntry, action: string): SyncPlanInfoEntry => ({
  entry: entry.entry,
  pullRequest: entry.pullRequest,
  actions: [action],
});

export const buildSyncPlanFromStatus = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string,
): SyncPlan => {
  const analysis = analyzeReviewStack(entries, defaultBranch);
  const githubActions = analysis.syncableEntries.map(
    ({
      entry,
      pullRequest,
      remoteBranchExists,
      needsBookmarkPush,
      intendedBaseBranch,
    }): SyncPlanEntry => ({
      entry,
      intendedBaseBranch,
      pullRequest,
      remoteBranchExists,
      needsBookmarkPush,
      actions: buildGithubPlanActions(
        entry,
        pullRequest,
        intendedBaseBranch,
        remoteBranchExists,
        needsBookmarkPush,
      ),
    }),
  );
  const executableGithubActions = githubActions.some((entry) => entry.actions.length > 0);

  return {
    localActions: analysis.localActions,
    githubActions,
    landedEntries: analysis.landedEntries.map((entry) =>
      toInfoEntry(
        entry,
        `PR #${entry.pullRequest?.number ?? "?"} is merged; removed from active stack`,
      ),
    ),
    closedEntries: analysis.closedEntries.map((entry) =>
      toInfoEntry(
        entry,
        `PR #${entry.pullRequest?.number ?? "?"} is ${entry.pullRequest?.state?.toLowerCase() ?? "not open"}; removed from active stack`,
      ),
    ),
    blockedEntries: analysis.blockedEntries.map((entry) =>
      toInfoEntry(
        entry,
        entry.blockedBy === entry.entry.name
          ? "blocked by local conflict; resolve before syncing this subtree"
          : `blocked by local conflict in ${entry.blockedBy}; resolve parent before syncing this subtree`,
      ),
    ),
    hasExecutableWork:
      analysis.completionState === "stack-complete" ||
      analysis.completionState === "active-stack" ||
      executableGithubActions,
    completionState: analysis.completionState,
  };
};

const entryDepth = (
  entry: StackStatusEntry,
  entriesByName: ReadonlyMap<string, StackStatusEntry>,
): number => {
  let depth = 0;
  let parentName = entry.entry.parentBookmarkName;

  while (parentName !== undefined) {
    const parent = entriesByName.get(parentName);
    if (parent === undefined) {
      break;
    }

    depth += 1;
    parentName = parent.entry.parentBookmarkName;
  }

  return depth;
};

const renderStackNode = (entry: StackStatusEntry, isCurrent: boolean, depth: number): string => {
  const indent = "  ".repeat(depth);
  const blocked =
    entry.blockedBy === undefined
      ? ""
      : entry.blockedBy === entry.entry.name
        ? " (blocked by conflict)"
        : ` (blocked by conflict in ${entry.blockedBy})`;
  if (entry.pullRequest === null) {
    return `${indent}- ${isCurrent ? "**current** " : ""}\`${entry.entry.name}\` -> pending PR${blocked}`;
  }

  return `${indent}- ${isCurrent ? "**current** " : ""}[#${entry.pullRequest.number}](${entry.pullRequest.url}) \`${entry.entry.name}\`${blocked}`;
};

export const renderStackComment = (
  entries: ReadonlyArray<StackStatusEntry>,
  currentPullRequestNumber?: number,
): string => {
  const fallbackCurrentPullRequestNumber = entries[entries.length - 1]?.pullRequest?.number;
  const highlightedPullRequestNumber = currentPullRequestNumber ?? fallbackCurrentPullRequestNumber;
  const currentBookmarkName = entries.find((entry) => entry.entry.isCurrent)?.entry.name;
  const entriesByName = new Map(entries.map((entry) => [entry.entry.name, entry] as const));

  return [
    STACK_COMMENT_MARKER,
    "Stack created by `jjacks`.",
    "",
    ...entries.map((entry, index) =>
      renderStackNode(
        entry,
        currentPullRequestNumber === undefined
          ? currentBookmarkName === undefined
            ? index === entries.length - 1
            : entry.entry.name === currentBookmarkName
          : entry.pullRequest?.number !== undefined &&
              entry.pullRequest.number === highlightedPullRequestNumber,
        entryDepth(entry, entriesByName),
      ),
    ),
    "",
    STACK_COMMENT_END_MARKER,
  ].join("\n");
};

export const upsertStackCommentInBody = (body: string, stackComment: string): string => {
  const start = body.indexOf(STACK_COMMENT_MARKER);
  const end = body.indexOf(STACK_COMMENT_END_MARKER);

  if (start !== -1 && end !== -1 && end >= start) {
    const prefix = body.slice(0, start).trimEnd();
    const suffix = body.slice(end + STACK_COMMENT_END_MARKER.length).trimStart();
    return [prefix, stackComment, suffix].filter((part) => part.length > 0).join("\n\n");
  }

  if (body.trim().length === 0) {
    return stackComment;
  }

  return `${body.trimEnd()}\n\n${stackComment}`;
};

export const stackCommentMarker = STACK_COMMENT_MARKER;
