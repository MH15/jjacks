export interface BookmarkNode {
  readonly name: string;
  readonly changeId: string;
  readonly commitId: string;
  readonly description: string;
  readonly parentBookmarkName: string | undefined;
}

export interface StackEntry extends BookmarkNode {
  readonly branchName: string;
  readonly isCurrent: boolean;
  readonly isEmpty?: boolean;
}

export interface PullRequestSummary {
  readonly number: number;
  readonly url: string;
  readonly title: string;
  readonly headRefName: string;
  readonly baseRefName: string;
  readonly isDraft: boolean;
  readonly body: string;
}

export interface PullRequestComment {
  readonly id: number;
  readonly body: string;
  readonly url: string;
}

export interface StackStatusEntry {
  readonly entry: StackEntry;
  readonly pullRequest: PullRequestSummary | null;
  readonly remoteBranchExists: boolean;
  readonly needsBookmarkPush: boolean;
}

export interface SyncPlanEntry {
  readonly entry: StackEntry;
  readonly intendedBaseBranch: string;
  readonly pullRequest: PullRequestSummary | null;
  readonly remoteBranchExists: boolean;
  readonly needsBookmarkPush: boolean;
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

export interface ExecuteSyncResult {
  readonly pushedBookmarks: ReadonlyArray<string>;
  readonly createdPullRequestBookmarks: ReadonlyArray<string>;
  readonly updatedPullRequestNumbers: ReadonlyArray<number>;
  readonly updatedCommentPullRequestNumbers: ReadonlyArray<number>;
  readonly warnings: ReadonlyArray<string>;
  readonly plan: SyncPlan;
  readonly statusEntries: ReadonlyArray<StackStatusEntry>;
}
