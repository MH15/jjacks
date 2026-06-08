import chalk, { Chalk } from "chalk";

import type { ExecuteSyncResult, PullRequestSummary, StackStatusEntry, SyncPlan } from "./domain";
import type { GetPlan } from "./get";

const formatLabel = (label: string): string => chalk.gray(`${label}:`);

const formatRemoteState = (remoteBranchExists: boolean, needsBookmarkPush: boolean): string =>
  !remoteBranchExists
    ? chalk.yellow("not pushed")
    : needsBookmarkPush
      ? chalk.yellow("needs push")
      : chalk.green("pushed");

const formatBlocked = (entry: StackStatusEntry): string => {
  if (entry.blockedBy === undefined) {
    return "";
  }

  return entry.blockedBy === entry.entry.name
    ? `, ${chalk.red("blocked by local conflict")}`
    : `, ${chalk.red(`blocked by conflict in ${entry.blockedBy}`)}`;
};

const formatStatusPullRequest = (pullRequest: PullRequestSummary | null): string =>
  pullRequest === null
    ? chalk.yellow("no PR yet")
    : [
        chalk.cyan(`PR #${pullRequest.number}`),
        `${formatLabel("base")} ${pullRequest.baseRefName}`,
        ...(pullRequest.state === undefined
          ? []
          : [`${formatLabel("state")} ${pullRequest.state.toLowerCase()}`]),
      ].join(", ");

export const renderDoctor = ({
  repoRoot,
  entries,
}: {
  readonly repoRoot: string;
  readonly entries: ReadonlyArray<StackStatusEntry>;
}): string =>
  [
    chalk.cyan("checks"),
    `- ${formatLabel("advance-bookmarks.enabled")} ${chalk.green("true")}`,
    `- ${formatLabel("repo root")} ${repoRoot}`,
    `- ${formatLabel("current stack entries")} ${entries.length}`,
  ].join("\n");

export const renderStatus = (repoRoot: string, entries: ReadonlyArray<StackStatusEntry>): string =>
  [
    chalk.cyan("stack"),
    `- ${formatLabel("repo root")} ${repoRoot}`,
    `- ${formatLabel("current entries")} ${entries.length}`,
    "",
    chalk.cyan("pull requests"),
    ...(entries.length === 0
      ? [
          `- ${chalk.yellow("no active bookmark stack")}`,
          `- ${formatLabel("next")} jjacks create <bookmark-name>`,
        ]
      : entries.map(
          (entry) =>
            [
              `- ${chalk.bold(entry.entry.name)}`,
              `${formatLabel("branch")} ${entry.entry.branchName}`,
              `${formatLabel("parent")} ${entry.entry.parentBookmarkName ?? "<trunk>"}`,
              formatRemoteState(entry.remoteBranchExists, entry.needsBookmarkPush),
              formatStatusPullRequest(entry.pullRequest),
            ].join(", ") + formatBlocked(entry),
        )),
  ].join("\n");

type RenderSyncPreviewOptions = {
  readonly color?: boolean;
};

const formatSyncHeader = (color: boolean): string =>
  color ? chalk.bold("jjacks sync plan") : "jjacks sync plan";

const formatBookmarkLine = (
  entry: SyncPlan["githubActions"][number] | SyncPlan["landedEntries"][number],
  color: boolean,
): string => {
  const name = color ? chalk.bold(entry.entry.name) : entry.entry.name;
  if (entry.pullRequest === null) {
    return name;
  }

  const prLink = color ? chalk.cyan(entry.pullRequest.url) : entry.pullRequest.url;
  return `${name} ${prLink}`;
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

const formatNoChanges = (color: boolean): string =>
  color ? chalk.gray("- no changes") : "- no changes";

const renderPlanEntries = (
  entries: ReadonlyArray<SyncPlan["githubActions"][number] | SyncPlan["landedEntries"][number]>,
  color: boolean,
): ReadonlyArray<string> =>
  entries.flatMap((entry, index) => {
    const renderedActions =
      entry.actions.length === 0
        ? [formatNoChanges(color)]
        : entry.actions.map((action) => formatAction(action, color));

    return [...(index === 0 ? [] : [""]), formatBookmarkLine(entry, color), ...renderedActions];
  });

export const renderSyncPlan = (plan: SyncPlan, options: RenderSyncPreviewOptions = {}): string => {
  const color = options.color ?? false;

  return [
    formatSyncHeader(color),
    ...(plan.localActions.length === 0
      ? []
      : [
          "",
          color ? chalk.cyan("local") : "local",
          ...plan.localActions.map((action) => formatAction(action, color)),
        ]),
    ...(plan.landedEntries.length === 0
      ? []
      : [
          "",
          color ? chalk.cyan("completed") : "completed",
          ...renderPlanEntries(plan.landedEntries, color),
        ]),
    ...(plan.closedEntries.length === 0
      ? []
      : [
          "",
          color ? chalk.cyan("closed") : "closed",
          ...renderPlanEntries(plan.closedEntries, color),
        ]),
    ...(plan.blockedEntries.length === 0
      ? []
      : [
          "",
          color ? chalk.cyan("blocked") : "blocked",
          ...renderPlanEntries(plan.blockedEntries, color),
        ]),
    ...(plan.githubActions.length === 0
      ? []
      : [
          "",
          color ? chalk.cyan("github") : "github",
          ...renderPlanEntries(plan.githubActions, color),
        ]),
    ...(plan.completionState === "stack-complete"
      ? ["", "No syncable stack remains.", "next: jjacks create <bookmark-name>"]
      : []),
  ].join("\n");
};

export const renderSyncPreview = (plan: SyncPlan, options: RenderSyncPreviewOptions = {}): string =>
  plan.completionState === "empty"
    ? [
        formatSyncHeader(options.color ?? false),
        ...(plan.localActions.length === 0
          ? []
          : [
              "",
              options.color === true ? chalk.cyan("local") : "local",
              ...plan.localActions.map((action) => formatAction(action, options.color ?? false)),
            ]),
        "",
        "no active bookmark stack",
        "next: jjacks create <bookmark-name>",
      ].join("\n")
    : renderSyncPlan(plan, options);

const formatSummaryCount = (
  count: number,
  singular: string,
  plural: string = `${singular}s`,
): string => (count === 0 ? `no ${plural}` : `${count} ${count === 1 ? singular : plural}`);

export const renderExecuteSummary = (result: ExecuteSyncResult): string => {
  const pullRequestChanges =
    result.createdPullRequestBookmarks.length + result.updatedPullRequestNumbers.length;
  const summary = [
    formatSummaryCount(result.pushedBookmarks.length, "push", "pushes"),
    formatSummaryCount(pullRequestChanges, "PR", "PRs"),
    formatSummaryCount(result.updatedCommentPullRequestNumbers.length, "comment"),
  ].join(", ");

  const warningSummary =
    result.warnings.length === 0
      ? undefined
      : `warnings:\n${result.warnings.map((warning) => `- ${warning}`).join("\n")}`;

  return [summary, warningSummary].filter(Boolean).join("\n");
};

export const renderGetPlan = (plan: GetPlan): string =>
  [
    chalk.bold("jjacks get plan"),
    "",
    chalk.cyan(plan.branchName),
    `- remote: ${plan.remote.commitId}`,
    ...(plan.local === undefined ? ["- local: not found"] : [`- local: ${plan.local.commitId}`]),
    "",
    ...(plan.willOverwriteLocal ? [chalk.yellow("local bookmark will be overwritten"), ""] : []),
    ...plan.actions.map((action) => `- ${action}`),
  ].join("\n");

export const formatMergeConfirmationMessage = ({
  bookmarkName,
  pullRequest,
  color = false,
}: {
  readonly bookmarkName: string;
  readonly pullRequest: PullRequestSummary;
  readonly color?: boolean;
}): string => {
  const colors = new Chalk({ level: color ? 1 : 0 });

  return [
    "Merge the bottom PR in this stack?",
    `${colors.cyan(`PR #${pullRequest.number}`)}: ${pullRequest.title}`,
    `${colors.gray("bookmark:")} ${bookmarkName}`,
    colors.gray(pullRequest.url),
    "",
    "Confirm merge",
  ].join("\n");
};
