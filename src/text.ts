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
      : entries.map(({ entry, pullRequest, remoteBranchExists, needsBookmarkPush, blockedBy }) => {
          const parent = entry.parentBookmarkName ?? "<trunk>";
          const remote = !remoteBranchExists ? "not pushed" : needsBookmarkPush ? "needs push" : "pushed";
          const blocked =
            blockedBy === undefined
              ? ""
              : blockedBy === entry.name
              ? " | blocked: local conflict"
              : ` | blocked: conflict in ${blockedBy}`;
          return `- ${entry.name} -> ${entry.branchName} | parent: ${parent} | remote: ${remote} | pr: ${formatPr(pullRequest)}${blocked}`;
        }))
  ].join("\n");

type RenderSyncPreviewOptions = {
  readonly color?: boolean;
};

const formatSyncHeader = (color: boolean): string => (color ? chalk.bold("jjacks sync plan") : "jjacks sync plan");

const formatBookmarkLine = (
  entry: SyncPlan["githubActions"][number] | SyncPlan["landedEntries"][number],
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

const renderPlanEntries = (
  entries: ReadonlyArray<SyncPlan["githubActions"][number] | SyncPlan["landedEntries"][number]>,
  color: boolean
): ReadonlyArray<string> =>
  entries.flatMap((entry, index) => {
    const renderedActions =
      entry.actions.length === 0 ? [formatNoChanges(color)] : entry.actions.map((action) => formatAction(action, color));

    return [...(index === 0 ? [] : [""]), formatBookmarkLine(entry, color), ...renderedActions];
  });

export const renderSyncPlan = (plan: SyncPlan, options: RenderSyncPreviewOptions = {}): string => {
  const color = options.color ?? false;

  return [
    formatSyncHeader(color),
    ...(plan.localActions.length === 0
      ? []
      : ["", color ? chalk.cyan("local") : "local", ...plan.localActions.map((action) => formatAction(action, color))]),
    ...(plan.landedEntries.length === 0 ? [] : ["", color ? chalk.cyan("completed") : "completed", ...renderPlanEntries(plan.landedEntries, color)]),
    ...(plan.closedEntries.length === 0 ? [] : ["", color ? chalk.cyan("closed") : "closed", ...renderPlanEntries(plan.closedEntries, color)]),
    ...(plan.blockedEntries.length === 0 ? [] : ["", color ? chalk.cyan("blocked") : "blocked", ...renderPlanEntries(plan.blockedEntries, color)]),
    ...(plan.githubActions.length === 0 ? [] : ["", color ? chalk.cyan("github") : "github", ...renderPlanEntries(plan.githubActions, color)]),
    ...(plan.completionState === "stack-complete"
      ? ["", "No syncable stack remains.", "next: jjacks create <bookmark-name>"]
      : [])
  ].join("\n");
};

export const renderSyncPreview = (plan: SyncPlan, options: RenderSyncPreviewOptions = {}): string =>
  plan.completionState === "empty"
    ? [
        formatSyncHeader(options.color ?? false),
        ...(plan.localActions.length === 0
          ? []
          : ["", options.color === true ? chalk.cyan("local") : "local", ...plan.localActions.map((action) => formatAction(action, options.color ?? false))]),
        "",
        "no active bookmark stack",
        "next: jjacks create <bookmark-name>"
      ].join("\n")
    : renderSyncPlan(plan, options);

const formatSummaryCount = (count: number, singular: string, plural: string = `${singular}s`): string =>
  count === 0 ? `no ${plural}` : `${count} ${count === 1 ? singular : plural}`;

export const renderExecuteSummary = (result: ExecuteSyncResult): string => {
  const pullRequestChanges = result.createdPullRequestBookmarks.length + result.updatedPullRequestNumbers.length;
  const summary = [
    formatSummaryCount(result.pushedBookmarks.length, "push", "pushes"),
    formatSummaryCount(pullRequestChanges, "PR", "PRs"),
    formatSummaryCount(result.updatedCommentPullRequestNumbers.length, "comment")
  ].join(", ");

  const warningSummary =
    result.warnings.length === 0 ? undefined : `warnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}`;

  return [summary, warningSummary].filter(Boolean).join("\n");
};
