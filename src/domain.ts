export interface BookmarkNode {
  readonly name: string;
  readonly changeId: string;
  readonly commitId: string;
  readonly parentBookmarkName: string | undefined;
}

export interface StackEntry extends BookmarkNode {
  readonly branchName: string;
}

export interface PullRequestSummary {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly isDraft: boolean;
}

export interface StackStatusEntry {
  readonly entry: StackEntry;
  readonly pullRequest: PullRequestSummary | null;
}

export interface SyncPlanEntry {
  readonly entry: StackEntry;
  readonly intendedBaseBranch: string;
  readonly pullRequest: PullRequestSummary | null;
  readonly actions: ReadonlyArray<string>;
}

export interface SyncPlan {
  readonly stack: ReadonlyArray<SyncPlanEntry>;
}

export interface RepoInfo {
  readonly root: string;
  readonly gitRemote: string | undefined;
  readonly defaultBranch: string | undefined;
}
