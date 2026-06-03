import type { PullRequestSummary, StackEntry, StackStatusEntry, SyncPlan, SyncPlanEntry } from "./domain.js";

const STACK_COMMENT_MARKER = "<!-- jjacks:stack -->";

const buildPlanActions = (
  entry: StackEntry,
  pullRequest: PullRequestSummary | null,
  intendedBaseBranch: string,
  remoteBranchExists: boolean
): ReadonlyArray<string> => [
  ...(remoteBranchExists ? [] : [`push bookmark with "jj git push --bookmark ${entry.name}" before opening or updating its PR`]),
  ...(pullRequest === null ? [`create PR titled "${entry.name}" with base ${intendedBaseBranch}`] : []),
  ...(pullRequest !== null && pullRequest.title !== entry.name
    ? [`rename PR #${pullRequest.number} from "${pullRequest.title}" to "${entry.name}"`]
    : []),
  ...(pullRequest !== null && pullRequest.baseRefName !== intendedBaseBranch
    ? [`retarget PR #${pullRequest.number} base from ${pullRequest.baseRefName} to ${intendedBaseBranch}`]
    : []),
  "ensure stack-link comment is present and up to date"
];

export const buildSyncPlanFromStatus = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string
): SyncPlan => ({
  stack: entries.map(({ entry, pullRequest }, index): SyncPlanEntry => {
    const parent = entries[index - 1]?.entry;
    const intendedBaseBranch = parent?.branchName ?? defaultBranch;
    const remoteBranchExists = entries[index]!.remoteBranchExists;

    return {
      entry,
      intendedBaseBranch,
      pullRequest,
      remoteBranchExists,
      actions: buildPlanActions(entry, pullRequest, intendedBaseBranch, remoteBranchExists)
    };
  })
});

const renderStackNode = (entry: StackStatusEntry, isCurrent: boolean): string => {
  if (entry.pullRequest === null) {
    return `- ${isCurrent ? "**current** " : ""}\`${entry.entry.name}\` -> pending PR`;
  }

  return `- ${isCurrent ? "**current** " : ""}[#${entry.pullRequest.number}](${entry.pullRequest.url}) \`${entry.entry.name}\``;
};

export const renderStackComment = (entries: ReadonlyArray<StackStatusEntry>): string =>
  [
    STACK_COMMENT_MARKER,
    "Stack created by `jjacks`.",
    "",
    ...entries.map((entry, index) => renderStackNode(entry, index === entries.length - 1))
  ].join("\n");

export const stackCommentMarker = STACK_COMMENT_MARKER;
