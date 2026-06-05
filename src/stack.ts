import type { PullRequestSummary, StackEntry, StackStatusEntry, SyncPlan, SyncPlanEntry } from "./domain";

const STACK_COMMENT_MARKER = "<!-- jjacks:stack -->";

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
): SyncPlan => ({
  stack: entries.map(({ entry, pullRequest }, index): SyncPlanEntry => {
    const parent = [...entries.slice(0, index)]
      .reverse()
      .find((candidate) => !(candidate.entry.isEmpty === true && candidate.pullRequest === null))?.entry;
    const intendedBaseBranch = parent?.branchName ?? defaultBranch;
    const remoteBranchExists = entries[index]!.remoteBranchExists;
    const needsBookmarkPush = entries[index]!.needsBookmarkPush;

    return {
      entry,
      intendedBaseBranch,
      pullRequest,
      remoteBranchExists,
      needsBookmarkPush,
      actions: buildPlanActions(entry, pullRequest, intendedBaseBranch, remoteBranchExists, needsBookmarkPush)
    };
  })
});

const renderStackNode = (entry: StackStatusEntry, isCurrent: boolean): string => {
  if (entry.pullRequest === null) {
    return `- ${isCurrent ? "**current** " : ""}\`${entry.entry.name}\` -> pending PR`;
  }

  return `- ${isCurrent ? "**current** " : ""}[#${entry.pullRequest.number}](${entry.pullRequest.url}) \`${entry.entry.name}\``;
};

export const renderStackComment = (
  entries: ReadonlyArray<StackStatusEntry>,
  currentPullRequestNumber?: number
): string => {
  const fallbackCurrentPullRequestNumber = entries[entries.length - 1]?.pullRequest?.number;
  const highlightedPullRequestNumber = currentPullRequestNumber ?? fallbackCurrentPullRequestNumber;
  const currentBookmarkName = entries.find((entry) => entry.entry.isCurrent)?.entry.name;

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
          : entry.pullRequest?.number !== undefined && entry.pullRequest.number === highlightedPullRequestNumber
      )
    )
  ].join("\n");
};

export const stackCommentMarker = STACK_COMMENT_MARKER;
