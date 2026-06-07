import { Context, Effect, Layer, ParseResult, Schema } from "effect";

import { PullRequestComment, PullRequestSummary, type PullRequestComment as PullRequestCommentType, type PullRequestSummary as PullRequestSummaryType } from "../domain";
import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class GitHubService extends Context.Tag("GitHubService")<
  GitHubService,
  {
    readonly findPullRequestsByHeads: (
      branchNames: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyMap<string, PullRequestSummaryType>, CliError, ProcessService>;
    readonly findPullRequestByHead: (
      branchName: string
    ) => Effect.Effect<PullRequestSummaryType | null, CliError, ProcessService>;
    readonly createPullRequest: (options: {
      readonly headBranch: string;
      readonly baseBranch: string;
      readonly title: string;
      readonly body?: string;
    }) => Effect.Effect<PullRequestSummaryType, CliError, ProcessService>;
    readonly updatePullRequest: (options: {
      readonly number: number;
      readonly baseBranch?: string;
      readonly title?: string;
      readonly body?: string;
    }) => Effect.Effect<void, CliError, ProcessService>;
    readonly listIssueComments: (
      pullRequestNumber: number
    ) => Effect.Effect<ReadonlyArray<PullRequestCommentType>, CliError, ProcessService>;
    readonly createIssueComment: (options: {
      readonly pullRequestNumber: number;
      readonly body: string;
    }) => Effect.Effect<void, CliError, ProcessService>;
    readonly updateIssueComment: (options: {
      readonly commentId: number;
      readonly body: string;
    }) => Effect.Effect<void, CliError, ProcessService>;
  }
>() {}

const decodeWithSchema = <A, I>(schema: Schema.Schema<A, I>, value: unknown, context: string) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError((error) =>
      new CliError(`${context}\n${ParseResult.TreeFormatter.formatErrorSync(error)}`)
    )
  );

const prStatePriority = (pullRequest: PullRequestSummaryType): number =>
  pullRequest.state === "OPEN" || pullRequest.state === undefined
    ? 0
    : pullRequest.state === "MERGED"
      ? 1
      : 2;

const make = {
  findPullRequestsByHeads: (branchNames: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (branchNames.length === 0) {
        return new Map();
      }

      const process = yield* ProcessService;
      const result = yield* process.run("gh", [
        "pr",
        "list",
        "--state",
        "all",
        "--json",
        "number,url,title,headRefName,baseRefName,state,isDraft,body",
        "--limit",
        "200"
      ]);

      const requestedBranches = new Set(branchNames);
      const pullRequests = yield* decodeWithSchema(
        Schema.parseJson(Schema.Array(PullRequestSummary)),
        result.stdout,
        "Failed to decode gh pr list output"
      );

      const resultByHead = new Map<string, PullRequestSummaryType>();
      for (const pullRequest of pullRequests) {
        if (!requestedBranches.has(pullRequest.headRefName)) {
          continue;
        }

        const existing = resultByHead.get(pullRequest.headRefName);
        if (existing === undefined || prStatePriority(pullRequest) < prStatePriority(existing)) {
          resultByHead.set(pullRequest.headRefName, pullRequest);
        }
      }

      return resultByHead;
    }),

  findPullRequestByHead: (branchName: string) =>
    Effect.gen(function* () {
      const pullRequests = yield* make.findPullRequestsByHeads([branchName]);
      return pullRequests.get(branchName) ?? null;
    }),

  createPullRequest: ({
    headBranch,
    baseBranch,
    title,
    body
  }: {
    readonly headBranch: string;
    readonly baseBranch: string;
    readonly title: string;
    readonly body?: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* process
        .run("gh", [
          "pr",
          "create",
          "--head",
          headBranch,
          "--base",
          baseBranch,
          "--title",
          title,
          "--body",
          body ?? ""
        ])
        .pipe(
          Effect.catchIf(
            (error): error is CliError =>
              error instanceof CliError && error.message.includes("No commits between"),
            () =>
              Effect.fail(
                new CliError(
                  [
                    `GitHub refused to create a PR for ${headBranch} against ${baseBranch} because there are no commits between them.`,
                    `This usually means your local stack still reflects an old base.`,
                    `Run "jjacks sync" again after resolving any local restack issues.`
                  ].join("\n")
                )
              )
          )
        );

      const created = yield* make.findPullRequestByHead(headBranch);
      if (created === null) {
        return yield* Effect.fail(new CliError(`gh created no discoverable PR for branch ${headBranch}.`));
      }

      return created;
    }),

  updatePullRequest: ({
    number,
    baseBranch,
    title,
    body
  }: {
    readonly number: number;
    readonly baseBranch?: string;
    readonly title?: string;
    readonly body?: string;
  }) =>
    Effect.gen(function* () {
      const args = ["pr", "edit", String(number)] as Array<string>;

      if (baseBranch !== undefined) {
        args.push("--base", baseBranch);
      }

      if (title !== undefined) {
        args.push("--title", title);
      }

      if (body !== undefined) {
        args.push("--body", body);
      }

      if (args.length === 3) {
        return;
      }

      const process = yield* ProcessService;
      yield* process.run("gh", args);
    }),

  listIssueComments: (pullRequestNumber: number) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      const result = yield* process.run("gh", [
        "api",
        `/repos/{owner}/{repo}/issues/${pullRequestNumber}/comments`
      ]);

      return yield* decodeWithSchema(
        Schema.parseJson(Schema.Array(PullRequestComment)),
        result.stdout,
        `Failed to decode issue comments for PR #${pullRequestNumber}`
      );
    }),

  createIssueComment: ({
    pullRequestNumber,
    body
  }: {
    readonly pullRequestNumber: number;
    readonly body: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* process.run("gh", [
        "api",
        "--method",
        "POST",
        `/repos/{owner}/{repo}/issues/${pullRequestNumber}/comments`,
        "-f",
        `body=${body}`
      ]);
    }),

  updateIssueComment: ({
    commentId,
    body
  }: {
    readonly commentId: number;
    readonly body: string;
  }) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      yield* process.run("gh", [
        "api",
        "--method",
        "PATCH",
        `/repos/{owner}/{repo}/issues/comments/${commentId}`,
        "-f",
        `body=${body}`
      ]);
    })
};

export const GitHubServiceLive = Layer.succeed(GitHubService, make);
