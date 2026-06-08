import { describe, expect, it } from "vitest";
import { Effect, Layer, Cause } from "effect";

import { CliError } from "../src/errors";
import { GitHubService, GitHubServiceLive } from "../src/services/GitHubService";
import { ProcessService } from "../src/services/ProcessService";

describe("GitHubService.findPullRequestsByHeads", () => {
  it("queries each branch by exact head and prefers open PRs over merged PRs", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const processLayer = Layer.succeed(ProcessService, {
      run: (_command: string, args: ReadonlyArray<string>) => {
        calls.push(args);
        const branchName = args[args.indexOf("--head") + 1];
        return Effect.succeed({
          stdout: JSON.stringify(
            branchName === "mh/open-questions"
              ? [
                  {
                    number: 55,
                    url: "https://github.com/MH15/jjacks/pull/55",
                    title: "merged",
                    headRefName: "mh/open-questions",
                    headRepositoryOwner: "MH15",
                    baseRefName: "main",
                    state: "MERGED",
                    isDraft: false,
                    body: ""
                  }
                ]
              : [
                  {
                    number: 56,
                    url: "https://github.com/MH15/jjacks/pull/56",
                    title: "merged",
                    headRefName: "remove-refresh",
                    headRepositoryOwner: "MH15",
                    baseRefName: "mh/open-questions",
                    state: "MERGED",
                    isDraft: false,
                    body: ""
                  },
                  {
                    number: 57,
                    url: "https://github.com/MH15/jjacks/pull/57",
                    title: "open",
                    headRefName: "remove-refresh",
                    headRepositoryOwner: "coworker",
                    baseRefName: "main",
                    state: "OPEN",
                    isDraft: false,
                    body: ""
                  }
                ]
          ),
          stderr: "",
          exitCode: 0
        });
      }
    });

    const pullRequests = await Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* GitHubService;
        return yield* github.findPullRequestsByHeads(["mh/open-questions", "remove-refresh"]);
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, GitHubServiceLive)))
    );

    expect(calls[0]).toEqual([
      "pr",
      "list",
      "--head",
      "mh/open-questions",
      "--state",
      "all",
      "--json",
      "number,url,title,headRefName,headRepositoryOwner,baseRefName,state,isDraft,body",
      "--jq",
      expect.any(String)
    ]);
    expect(calls[1]).toEqual([
      "pr",
      "list",
      "--head",
      "remove-refresh",
      "--state",
      "all",
      "--json",
      "number,url,title,headRefName,headRepositoryOwner,baseRefName,state,isDraft,body",
      "--jq",
      expect.any(String)
    ]);
    expect(pullRequests.get("mh/open-questions")?.state).toBe("MERGED");
    expect(pullRequests.get("remove-refresh")?.number).toBe(57);
    expect(pullRequests.get("remove-refresh")?.headRepositoryOwner).toBe("coworker");
  });

  it("fails when more than one open PR matches the same branch", async () => {
    const processLayer = Layer.succeed(ProcessService, {
      run: () =>
        Effect.succeed({
          stdout: JSON.stringify([
            {
              number: 12,
              url: "https://github.com/MH15/jjacks/pull/12",
              title: "first",
              headRefName: "feat/shared",
              headRepositoryOwner: "alice",
              baseRefName: "main",
              state: "OPEN",
              isDraft: false,
              body: ""
            },
            {
              number: 13,
              url: "https://github.com/MH15/jjacks/pull/13",
              title: "second",
              headRefName: "feat/shared",
              headRepositoryOwner: "bob",
              baseRefName: "main",
              state: "OPEN",
              isDraft: false,
              body: ""
            }
          ]),
          stderr: "",
          exitCode: 0
        })
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const github = yield* GitHubService;
        return yield* github.findPullRequestsByHeads(["feat/shared"]);
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, GitHubServiceLive)))
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(CliError);
        expect(failure.value.message).toContain("Multiple open pull requests found for branch feat/shared");
        expect(failure.value.message).toContain("PR #12 alice:feat/shared");
        expect(failure.value.message).toContain("PR #13 bob:feat/shared");
      }
    }
  });
});

describe("GitHubService.createPullRequest", () => {
  it("turns the no-commits-between GitHub error into a sync hint", async () => {
    const processLayer = Layer.succeed(ProcessService, {
      run: (_command: string, args: ReadonlyArray<string>) => {
        if (args[0] === "pr" && args[1] === "create") {
          return Effect.fail(
            new CliError(
              [
                "Command failed: gh pr create --head feat/ui --base main --title feat/ui --body ",
                "pull request create failed: GraphQL: No commits between main and feat/ui (createPullRequest)"
              ].join("\n")
            )
          );
        }

        return Effect.die(`Unexpected command: gh ${args.join(" ")}`);
      }
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const github = yield* GitHubService;
        return yield* github.createPullRequest({
          headBranch: "feat/ui",
          baseBranch: "main",
          title: "feat/ui"
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, GitHubServiceLive)))
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(CliError);
        expect(failure.value.message).toContain('Run "jjacks sync" again');
        expect(failure.value.message).toContain("no commits between them");
      }
    }
  });
});

describe("GitHubService.mergePullRequestWhenReady", () => {
  it("asks GitHub to merge when repository requirements are satisfied", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const processLayer = Layer.succeed(ProcessService, {
      run: (_command: string, args: ReadonlyArray<string>) => {
        calls.push(args);
        return Effect.succeed({
          stdout: "",
          stderr: "",
          exitCode: 0
        });
      }
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const github = yield* GitHubService;
        yield* github.mergePullRequestWhenReady(42);
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, GitHubServiceLive)))
    );

    expect(calls).toEqual([["pr", "merge", "42", "--squash", "--auto"]]);
  });
});

describe("GitHubService.listIssueComments", () => {
  it("returns a CliError when gh emits malformed JSON", async () => {
    const processLayer = Layer.succeed(ProcessService, {
      run: () =>
        Effect.succeed({
          stdout: "{not-json",
          stderr: "",
          exitCode: 0
        })
    });

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const github = yield* GitHubService;
        return yield* github.listIssueComments(38);
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, GitHubServiceLive)))
    );

    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const failure = Cause.failureOption(exit.cause);
      expect(failure._tag).toBe("Some");
      if (failure._tag === "Some") {
        expect(failure.value).toBeInstanceOf(CliError);
        expect(failure.value.message).toContain("Failed to decode issue comments for PR #38");
      }
    }
  });
});
