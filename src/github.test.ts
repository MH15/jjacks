import { describe, expect, it } from "vitest";
import { Effect, Layer, Cause } from "effect";

import { CliError } from "../src/errors";
import { GitHubService, GitHubServiceLive } from "../src/services/GitHubService";
import { ProcessService } from "../src/services/ProcessService";

describe("GitHubService.findPullRequestsByHeads", () => {
  it("looks across all PR states and prefers open PRs for duplicate heads", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const processLayer = Layer.succeed(ProcessService, {
      run: (_command: string, args: ReadonlyArray<string>) => {
        calls.push(args);
        return Effect.succeed({
          stdout: JSON.stringify([
            {
              number: 55,
              url: "https://github.com/MH15/jjacks/pull/55",
              title: "merged",
              headRefName: "mh/open-questions",
              baseRefName: "main",
              state: "MERGED",
              isDraft: false,
              body: ""
            },
            {
              number: 56,
              url: "https://github.com/MH15/jjacks/pull/56",
              title: "open",
              headRefName: "remove-refresh",
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
              baseRefName: "main",
              state: "OPEN",
              isDraft: false,
              body: ""
            }
          ]),
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
      "--state",
      "all",
      "--json",
      "number,url,title,headRefName,baseRefName,state,isDraft,body",
      "--limit",
      "200"
    ]);
    expect(pullRequests.get("mh/open-questions")?.state).toBe("MERGED");
    expect(pullRequests.get("remove-refresh")?.number).toBe(57);
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
