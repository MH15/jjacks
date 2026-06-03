import { Context, Effect, Layer } from "effect";

import type { PullRequestComment, PullRequestSummary } from "../domain";
import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class GitHubService extends Context.Tag("GitHubService")<
  GitHubService,
  {
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
  findPullRequestByHead: (branchName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      const result = yield* process.run(
        "gh",
        [
          "pr",
          "list",
          "--head",
          branchName,
          "--json",
          "number,url,title,headRefName,baseRefName,isDraft",
          "--limit",
          "1"
        ],
        { allowNonZeroExit: true }
      );

      if (result.exitCode !== 0 || result.stdout.length === 0) {
        return null;
      }

      const parsed = JSON.parse(result.stdout) as Array<PullRequestSummary>;
      return parsed[0] ?? null;
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
      yield* process.run("gh", [
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
      ]);

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
