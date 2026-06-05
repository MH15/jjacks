import chalk from "chalk";

import type { ExecuteSyncResult, PullRequestSummary, StackStatusEntry, SyncPlan } from "./domain";

const formatPr = (pr: PullRequestSummary | null): string =>
  pr === null ? "missing" : `#${pr.number} ${pr.title} (${pr.baseRefName} <- ${pr.headRefName})`;

export const renderDoctor = (checks: ReadonlyArray<string>): string =>
  ["jjacks doctor", ...checks.map((check) => `- ${check}`)].join("\n");

export const renderStatus = (repoRoot: string, entries: ReadonlyArray<StackStatusEntry>): string =>
  [
    `jjacks status`,
    `repo: ${repoRoot}`,
    ...(entries.length === 0
      ? ["no active bookmark stack", "next: jjacks create <bookmark-name>"]
      : entries.map(({ entry, pullRequest, remoteBranchExists, needsBookmarkPush }) => {
          const parent = entry.parentBookmarkName ?? "<trunk>";
          const remote = !remoteBranchExists ? "not pushed" : needsBookmarkPush ? "needs push" : "pushed";
          return `- ${entry.name} -> ${entry.branchName} | parent: ${parent} | remote: ${remote} | pr: ${formatPr(pullRequest)}`;
        }))
  ].join("\n");

type RenderSyncPreviewOptions = {
  readonly color?: boolean;
};

const formatSyncHeader = (color: boolean): string => (color ? chalk.bold("jjacks sync plan") : "jjacks sync plan");

const formatBookmarkLine = (
  entry: SyncPlan["stack"][number],
  color: boolean
): string => {
  const name = color ? chalk.bold(entry.entry.name) : entry.entry.name;
  if (entry.pullRequest === null) {
    return name;
  }

  const prLabel = color ? chalk.cyan(`PR #${entry.pullRequest.number}`) : `PR #${entry.pullRequest.number}`;
  return `${name} (${prLabel})`;
};

const formatAction = (action: string, color: boolean): string => {
  if (!color) {
    return `- ${action}`;
  }

  if (action.startsWith("push bookmark") || action.startsWith("create PR")) {
    return chalk.green(`- ${action}`);
  }

  if (
    action.startsWith("set jj change description") ||
    action.startsWith("rename PR") ||
    action.startsWith("retarget PR")
  ) {
    return chalk.yellow(`- ${action}`);
  }

  return `- ${action}`;
};

const formatNoChanges = (color: boolean): string => (color ? chalk.gray("- no changes") : "- no changes");

export const renderSyncPlan = (plan: SyncPlan, options: RenderSyncPreviewOptions = {}): string => {
  const color = options.color ?? false;

  return [
    formatSyncHeader(color),
    ...plan.stack.flatMap((entry, index) => {
      const renderedActions =
        entry.actions.length === 0 ? [formatNoChanges(color)] : entry.actions.map((action) => formatAction(action, color));

      return [...(index === 0 ? [] : [""]), formatBookmarkLine(entry, color), ...renderedActions];
    })
  ].join("\n");
};

export const renderSyncPreview = (plan: SyncPlan, options: RenderSyncPreviewOptions = {}): string =>
  plan.stack.length === 0
    ? [formatSyncHeader(options.color ?? false), "no active bookmark stack", "next: jjacks create <bookmark-name>"].join("\n")
    : renderSyncPlan(plan, options);

export const renderExecuteSummary = (result: ExecuteSyncResult): string => {
  const pushedSummary =
    result.pushedBookmarks.length === 0
      ? "no bookmark pushes were needed; PR contents were already current"
      : `pushed bookmarks (PR contents updated via branch push):\n${result.pushedBookmarks
          .map((name) => `- ${name}`)
          .join("\n")}`;
  const createdSummary =
    result.createdPullRequestBookmarks.length === 0
      ? "no pull requests were created"
      : `created pull requests:\n${result.createdPullRequestBookmarks.map((name) => `- ${name}`).join("\n")}`;
  const updatedSummary =
    result.updatedPullRequestNumbers.length === 0
      ? "no PR metadata updates were needed"
      : `updated PR metadata:\n${result.updatedPullRequestNumbers.map((number) => `- #${number}`).join("\n")}`;
  const commentSummary =
    result.updatedCommentPullRequestNumbers.length === 0
      ? "no stack comments were updated"
      : `updated stack comments:\n${result.updatedCommentPullRequestNumbers.map((number) => `- #${number}`).join("\n")}`;

  const warningSummary =
    result.warnings.length === 0 ? undefined : `warnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}`;

  return [pushedSummary, createdSummary, updatedSummary, commentSummary, warningSummary].filter(Boolean).join("\n");
};
