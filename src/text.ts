import type { PullRequestSummary, StackStatusEntry, SyncPlan } from "./domain";

const formatPr = (pr: PullRequestSummary | null): string =>
  pr === null ? "missing" : `#${pr.number} ${pr.title} (${pr.baseRefName} <- ${pr.headRefName})`;

export const renderDoctor = (checks: ReadonlyArray<string>): string =>
  ["jjacks doctor", ...checks.map((check) => `- ${check}`)].join("\n");

export const renderStatus = (repoRoot: string, entries: ReadonlyArray<StackStatusEntry>): string =>
  [
    `jjacks status`,
    `repo: ${repoRoot}`,
    ...entries.map(({ entry, pullRequest, remoteBranchExists, needsBookmarkPush }) => {
      const parent = entry.parentBookmarkName ?? "<trunk>";
      const remote = !remoteBranchExists ? "not pushed" : needsBookmarkPush ? "needs push" : "pushed";
      return `- ${entry.name} -> ${entry.branchName} | parent: ${parent} | remote: ${remote} | pr: ${formatPr(pullRequest)}`;
    })
  ].join("\n");

export const renderSyncPlan = (plan: SyncPlan): string =>
  [
    "jjacks sync plan",
    ...plan.stack.map(({ entry, intendedBaseBranch, pullRequest, remoteBranchExists, needsBookmarkPush, actions }) => {
      const remote = !remoteBranchExists ? "not pushed" : needsBookmarkPush ? "needs push" : "pushed";
      const summary = `- ${entry.name} -> ${entry.branchName} | base: ${intendedBaseBranch} | remote: ${remote} | pr: ${formatPr(pullRequest)}`;
      const renderedActions = actions.length === 0 ? "  - no changes" : actions.map((action) => `  - ${action}`).join("\n");
      return `${summary}\n${renderedActions}`;
    })
  ].join("\n");

export const renderSyncPreview = (plan: SyncPlan, stackComment: string): string =>
  [renderSyncPlan(plan), "", "stack comment preview", stackComment].join("\n");
