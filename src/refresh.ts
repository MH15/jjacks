import chalk from "chalk";

import type { StackStatusEntry } from "./domain";

export type RefreshPlan =
  | {
      readonly kind: "clean-trunk";
      readonly defaultBranch: string;
    }
  | {
      readonly kind: "continue-stack";
      readonly defaultBranch: string;
      readonly rootBookmarkName: string;
      readonly currentBookmarkName: string;
    };

export const resolveRefreshPlan = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string
): RefreshPlan => {
  const currentEntry = entries.find((entry) => entry.entry.isCurrent)?.entry;
  const rootEntry = entries[0]?.entry;
  if (rootEntry === undefined || currentEntry === undefined) {
    return {
      kind: "clean-trunk",
      defaultBranch
    };
  }

  return {
    kind: "continue-stack",
    defaultBranch,
    rootBookmarkName: rootEntry.name,
    currentBookmarkName: currentEntry.name
  };
};

type RenderRefreshSummaryOptions = {
  readonly color?: boolean;
};

const formatRefreshHeader = (color: boolean): string => (color ? chalk.bold("jjacks refresh") : "jjacks refresh");
const formatBranch = (value: string, color: boolean): string => (color ? chalk.cyan(value) : value);
const formatBookmark = (value: string, color: boolean): string => (color ? chalk.bold(value) : value);

export const renderRefreshSummary = (
  plan: RefreshPlan,
  workingCopyLog: string,
  options: RenderRefreshSummaryOptions = {}
): string => {
  const color = options.color ?? false;
  const defaultBranch = formatBranch(plan.defaultBranch, color);

  return [
    formatRefreshHeader(color),
    `- refreshed ${defaultBranch} from origin`,
    ...(plan.kind === "clean-trunk"
      ? [`- no remaining stack; continuing from ${defaultBranch}`]
      : [
          `- restacked remaining stack onto ${defaultBranch}`,
          `- continuing ${formatBookmark(plan.currentBookmarkName, color)}`
        ]),
    "",
    color ? chalk.dim("current jj state") : "current jj state",
    workingCopyLog
  ].join("\n");
};
