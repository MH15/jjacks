import * as Schema from "effect/Schema";

const OptionalString = Schema.optionalWith(Schema.UndefinedOr(Schema.String), { exact: true });
const OptionalBoolean = Schema.optionalWith(Schema.UndefinedOr(Schema.Boolean), { exact: true });

export const BookmarkNode = Schema.Struct({
  name: Schema.String,
  changeId: Schema.String,
  commitId: Schema.String,
  description: Schema.String,
  parentBookmarkName: OptionalString
}).annotations({ identifier: "BookmarkNode" });
export type BookmarkNode = Schema.Schema.Type<typeof BookmarkNode>;

export const StackEntry = Schema.Struct({
  ...BookmarkNode.fields,
  branchName: Schema.String,
  isCurrent: Schema.Boolean,
  isEmpty: OptionalBoolean
}).annotations({ identifier: "StackEntry" });
export type StackEntry = Schema.Schema.Type<typeof StackEntry>;

export const PullRequestSummary = Schema.Struct({
  number: Schema.Number,
  url: Schema.String,
  title: Schema.String,
  headRefName: Schema.String,
  baseRefName: Schema.String,
  isDraft: Schema.Boolean,
  body: Schema.String
}).annotations({ identifier: "PullRequestSummary" });
export type PullRequestSummary = Schema.Schema.Type<typeof PullRequestSummary>;

export const PullRequestComment = Schema.Struct({
  id: Schema.Number,
  body: Schema.String,
  url: Schema.String
}).annotations({ identifier: "PullRequestComment" });
export type PullRequestComment = Schema.Schema.Type<typeof PullRequestComment>;

export const StackStatusEntry = Schema.Struct({
  entry: StackEntry,
  pullRequest: Schema.NullOr(PullRequestSummary),
  remoteBranchExists: Schema.Boolean,
  needsBookmarkPush: Schema.Boolean
}).annotations({ identifier: "StackStatusEntry" });
export type StackStatusEntry = Schema.Schema.Type<typeof StackStatusEntry>;

export const SyncPlanEntry = Schema.Struct({
  entry: StackEntry,
  intendedBaseBranch: Schema.String,
  pullRequest: Schema.NullOr(PullRequestSummary),
  remoteBranchExists: Schema.Boolean,
  needsBookmarkPush: Schema.Boolean,
  actions: Schema.Array(Schema.String)
}).annotations({ identifier: "SyncPlanEntry" });
export type SyncPlanEntry = Schema.Schema.Type<typeof SyncPlanEntry>;

export const SyncPlan = Schema.Struct({
  stack: Schema.Array(SyncPlanEntry)
}).annotations({ identifier: "SyncPlan" });
export type SyncPlan = Schema.Schema.Type<typeof SyncPlan>;

export const RepoInfo = Schema.Struct({
  root: Schema.String,
  gitRemote: OptionalString,
  defaultBranch: OptionalString
}).annotations({ identifier: "RepoInfo" });
export type RepoInfo = Schema.Schema.Type<typeof RepoInfo>;

export const ExecuteSyncResult = Schema.Struct({
  pushedBookmarks: Schema.Array(Schema.String),
  createdPullRequestBookmarks: Schema.Array(Schema.String),
  updatedPullRequestNumbers: Schema.Array(Schema.Number),
  updatedCommentPullRequestNumbers: Schema.Array(Schema.Number),
  warnings: Schema.Array(Schema.String),
  plan: SyncPlan,
  statusEntries: Schema.Array(StackStatusEntry)
}).annotations({ identifier: "ExecuteSyncResult" });
export type ExecuteSyncResult = Schema.Schema.Type<typeof ExecuteSyncResult>;
