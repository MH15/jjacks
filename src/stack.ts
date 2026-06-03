import type { PullRequestSummary, StackEntry, StackStatusEntry, SyncPlan, SyncPlanEntry } from "./domain.js";

const STACK_COMMENT_MARKER = "<!-- jjacks:stack -->";

const buildPlanActions = (
  entry: StackEntry,
  pullRequest: PullRequestSummary | null,
  intendedBaseBranch: string
): ReadonlyArray<string> => [
  ...(pullRequest === null ? [`create PR titled "${entry.name}" with base ${intendedBaseBranch}`] : []),
  ...(pullRequest !== null && pullRequest.baseRefName !== intendedBaseBranch
    ? [`retarget PR #${pullRequest.number} base from ${pullRequest.baseRefName} to ${intendedBaseBranch}`]
    : []),
  "push skipped by default; manual push required before execute mode can succeed",
  "ensure stack-link comment is present and up to date"
];

export const buildSyncPlanFromStatus = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string
): SyncPlan => ({
  stack: entries.map(({ entry, pullRequest }, index): SyncPlanEntry => {
    const parent = entries[index - 1]?.entry;
    const intendedBaseBranch = parent?.branchName ?? defaultBranch;

    return {
      entry,
      intendedBaseBranch,
      pullRequest,
      actions: buildPlanActions(entry, pullRequest, intendedBaseBranch)
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
