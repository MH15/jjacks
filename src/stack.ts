import type { PullRequestSummary, StackEntry, StackStatusEntry, SyncPlan, SyncPlanEntry } from "./domain";

const STACK_COMMENT_MARKER = "<!-- jjacks:stack -->";
const STACK_COMMENT_END_MARKER = "<!-- /jjacks:stack -->";

const buildPlanActions = (
  entry: StackEntry,
  pullRequest: PullRequestSummary | null,
  intendedBaseBranch: string,
  remoteBranchExists: boolean,
  needsBookmarkPush: boolean
): ReadonlyArray<string> => [
  ...(entry.isEmpty === true && pullRequest === null ? ["empty change; skipping PR creation until it has commits"] : []),
  ...(entry.description.trim().length === 0 ? [`set jj change description to "${entry.name}"`] : []),
  ...(needsBookmarkPush && !(entry.isEmpty === true && pullRequest === null) ? ["push bookmark"] : []),
  ...(pullRequest === null && entry.isEmpty !== true ? [`create PR with base ${intendedBaseBranch}`] : []),
  ...(pullRequest !== null && pullRequest.title !== entry.name ? [`rename PR #${pullRequest.number} to "${entry.name}"`] : []),
  ...(pullRequest !== null && pullRequest.baseRefName !== intendedBaseBranch
    ? [`retarget PR #${pullRequest.number} base from ${pullRequest.baseRefName} to ${intendedBaseBranch}`]
    : [])
];

export const buildSyncPlanFromStatus = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string
): SyncPlan => {
  const entriesByName = new Map(entries.map((candidate) => [candidate.entry.name, candidate] as const));

  return {
    stack: entries.map(({ entry, pullRequest, remoteBranchExists, needsBookmarkPush }): SyncPlanEntry => {
      let parentEntry = entry.parentBookmarkName === undefined ? undefined : entriesByName.get(entry.parentBookmarkName);

      while (parentEntry !== undefined && parentEntry.entry.isEmpty === true && parentEntry.pullRequest === null) {
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
        actions: buildPlanActions(entry, pullRequest, intendedBaseBranch, remoteBranchExists, needsBookmarkPush)
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
  if (entry.pullRequest === null) {
    return `${indent}- ${isCurrent ? "**current** " : ""}\`${entry.entry.name}\` -> pending PR`;
  }

  return `${indent}- ${isCurrent ? "**current** " : ""}[#${entry.pullRequest.number}](${entry.pullRequest.url}) \`${entry.entry.name}\``;
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
