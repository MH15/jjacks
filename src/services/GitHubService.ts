import { Context, Effect, Layer } from "effect";

import type { PullRequestComment, PullRequestSummary } from "../domain";
import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class GitHubService extends Context.Tag("GitHubService")<
  GitHubService,
  {
    readonly findPullRequestsByHeads: (
      branchNames: ReadonlyArray<string>
    ) => Effect.Effect<ReadonlyMap<string, PullRequestSummary>, CliError, ProcessService>;
    readonly findPullRequestByHead: (
      branchName: string
    ) => Effect.Effect<PullRequestSummary | null, CliError, ProcessService>;
    readonly createPullRequest: (options: {
      readonly headBranch: string;
      readonly baseBranch: string;
      readonly title: string;
    }) => Effect.Effect<PullRequestSummary, CliError, ProcessService>;
    readonly updatePullRequest: (options: {
      readonly number: number;
      readonly baseBranch?: string;
      readonly title?: string;
    }) => Effect.Effect<void, CliError, ProcessService>;
    readonly listIssueComments: (
      pullRequestNumber: number
    ) => Effect.Effect<ReadonlyArray<PullRequestComment>, CliError, ProcessService>;
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
        "open",
        "--json",
        "number,url,title,headRefName,baseRefName,isDraft",
        "--limit",
        "200"
      ]);

      const requestedBranches = new Set(branchNames);
      const pullRequests = JSON.parse(result.stdout) as Array<PullRequestSummary>;

      return new Map(
        pullRequests
          .filter((pullRequest) => requestedBranches.has(pullRequest.headRefName))
          .map((pullRequest) => [pullRequest.headRefName, pullRequest] as const)
      );
    }),

  findPullRequestByHead: (branchName: string) =>
    Effect.gen(function* () {
      const pullRequests = yield* make.findPullRequestsByHeads([branchName]);
      return pullRequests.get(branchName) ?? null;
    }),

  createPullRequest: ({
    headBranch,
    baseBranch,
    title
  }: {
    readonly headBranch: string;
    readonly baseBranch: string;
    readonly title: string;
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
          ""
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
                    `Run "jjacks refresh" and then sync again.`
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
    title
  }: {
    readonly number: number;
    readonly baseBranch?: string;
    readonly title?: string;
  }) =>
    Effect.gen(function* () {
      const args = ["pr", "edit", String(number)] as Array<string>;

      if (baseBranch !== undefined) {
        args.push("--base", baseBranch);
      }

      if (title !== undefined) {
        args.push("--title", title);
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

      return JSON.parse(result.stdout) as Array<PullRequestComment>;
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

export const GitHubServiceLive = Layer.effect(GitHubService, Effect.succeed(make));
