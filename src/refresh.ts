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

export const renderRefreshSummary = (plan: RefreshPlan, workingCopyLog: string): string =>
  [
    "jjacks refresh",
    `- fetched origin`,
    `- moved ${plan.defaultBranch} to ${plan.defaultBranch}@origin`,
    ...(plan.kind === "clean-trunk"
      ? [
          `- no remaining stack found; created a fresh working-copy change on ${plan.defaultBranch}`,
          `- rebased @ onto ${plan.defaultBranch}`
        ]
      : [
          `- restacked remaining stack from ${plan.rootBookmarkName} onto ${plan.defaultBranch}`,
          `- created a fresh working-copy change to continue ${plan.tipBookmarkName}`
        ]),
    "",
    "current jj state",
    workingCopyLog
  ].join("\n");
