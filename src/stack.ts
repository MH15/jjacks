import type { PullRequestSummary, StackEntry, StackStatusEntry, SyncPlan, SyncPlanEntry } from "./domain";

const STACK_COMMENT_MARKER = "<!-- jjacks:stack -->";
const STACK_COMMENT_END_MARKER = "<!-- /jjacks:stack -->";

export const isPullRequestOpen = (pullRequest: PullRequestSummary): boolean =>
  pullRequest.state === undefined || pullRequest.state === "OPEN";

const formatClosedPullRequestAction = (pullRequest: PullRequestSummary): string =>
  pullRequest.state === "MERGED"
    ? `PR #${pullRequest.number} is merged; skipping GitHub updates`
    : `PR #${pullRequest.number} is ${pullRequest.state?.toLowerCase() ?? "not open"}; skipping GitHub updates`;

const isSyncableBaseEntry = (entry: StackStatusEntry): boolean =>
  !(entry.entry.isEmpty === true && entry.pullRequest === null) &&
  (entry.pullRequest === null || isPullRequestOpen(entry.pullRequest));

const buildPlanActions = (
  entry: StackEntry,
  pullRequest: PullRequestSummary | null,
  intendedBaseBranch: string,
  remoteBranchExists: boolean,
  needsBookmarkPush: boolean,
  blockedBy: string | undefined
): ReadonlyArray<string> => [
  ...(blockedBy !== undefined
    ? [
        blockedBy === entry.name
          ? "blocked by local conflict; resolve before syncing this subtree"
          : `blocked by local conflict in ${blockedBy}; resolve parent before syncing this subtree`
      ]
    : []),
  ...(entry.isEmpty === true && pullRequest === null ? ["empty change; skipping PR creation until it has commits"] : []),
  ...(entry.description.trim().length === 0 ? [`set jj change description to "${entry.name}"`] : []),
  ...(blockedBy === undefined &&
    needsBookmarkPush &&
    !(entry.isEmpty === true && pullRequest === null) &&
    (pullRequest === null || isPullRequestOpen(pullRequest))
    ? ["push bookmark"]
    : []),
  ...(blockedBy === undefined && pullRequest === null && entry.isEmpty !== true ? [`create PR with base ${intendedBaseBranch}`] : []),
  ...(blockedBy === undefined && pullRequest !== null && !isPullRequestOpen(pullRequest)
    ? [formatClosedPullRequestAction(pullRequest)]
    : []),
  ...(blockedBy === undefined && pullRequest !== null && isPullRequestOpen(pullRequest) && pullRequest.title !== entry.name ? [`rename PR #${pullRequest.number} to "${entry.name}"`] : []),
  ...(blockedBy === undefined && pullRequest !== null && isPullRequestOpen(pullRequest) && pullRequest.baseRefName !== intendedBaseBranch
    ? [`retarget PR #${pullRequest.number} base from ${pullRequest.baseRefName} to ${intendedBaseBranch}`]
    : [])
];

const buildLocalActions = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string
): ReadonlyArray<string> => {
  const currentEntry = entries.find((entry) => entry.entry.isCurrent)?.entry;
  const rootEntry = entries.find(isSyncableBaseEntry)?.entry;

  return [
    "fetch origin",
    `move ${defaultBranch} to ${defaultBranch}@origin`,
    ...(rootEntry === undefined || currentEntry === undefined
      ? []
      : [
          `rebase ${rootEntry.name} onto ${defaultBranch}`,
          `continue from ${currentEntry.name}`
        ])
  ];
};

export const buildSyncPlanFromStatus = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string
): SyncPlan => {
  const entriesByName = new Map(entries.map((candidate) => [candidate.entry.name, candidate] as const));

  return {
    localActions: buildLocalActions(entries, defaultBranch),
    stack: entries.map(({ entry, pullRequest, remoteBranchExists, needsBookmarkPush, blockedBy }): SyncPlanEntry => {
      let parentEntry = entry.parentBookmarkName === undefined ? undefined : entriesByName.get(entry.parentBookmarkName);

      while (parentEntry !== undefined && !isSyncableBaseEntry(parentEntry)) {
        parentEntry =
          parentEntry.entry.parentBookmarkName === undefined
            ? undefined
            : entriesByName.get(parentEntry.entry.parentBookmarkName);
      }

      const intendedBaseBranch = parentEntry?.entry.branchName ?? defaultBranch;

      return {
        entry,
        intendedBaseBranch,
        pullRequest,
        remoteBranchExists,
        needsBookmarkPush,
        actions: buildPlanActions(entry, pullRequest, intendedBaseBranch, remoteBranchExists, needsBookmarkPush, blockedBy)
      };
    })
  };
};

const entryDepth = (entry: StackStatusEntry, entriesByName: ReadonlyMap<string, StackStatusEntry>): number => {
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
  currentPullRequestNumber?: number
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
          : entry.pullRequest?.number !== undefined && entry.pullRequest.number === highlightedPullRequestNumber,
        entryDepth(entry, entriesByName)
      )
    ),
    "",
    STACK_COMMENT_END_MARKER
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
