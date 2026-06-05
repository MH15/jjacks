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
      readonly tipBookmarkName: string;
    };

export const resolveRefreshPlan = (
  entries: ReadonlyArray<StackStatusEntry>,
  defaultBranch: string
): RefreshPlan => {
  const rootBookmarkName = entries[0]?.entry.name;
  const tipBookmarkName = entries[entries.length - 1]?.entry.name;

  if (rootBookmarkName === undefined || tipBookmarkName === undefined) {
    return {
      kind: "clean-trunk",
      defaultBranch
    };
  }

  return {
    kind: "continue-stack",
    defaultBranch,
    rootBookmarkName,
    tipBookmarkName
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
          `- continuing ${formatBookmark(plan.tipBookmarkName, color)}`
        ]),
    "",
    color ? chalk.dim("current jj state") : "current jj state",
    workingCopyLog
  ].join("\n");
};
