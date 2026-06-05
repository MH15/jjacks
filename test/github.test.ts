import { describe, expect, it } from "vitest";
import { Effect, Layer, Cause } from "effect";

import { CliError } from "../src/errors";
import { GitHubService, GitHubServiceLive } from "../src/services/GitHubService";
import { ProcessService } from "../src/services/ProcessService";

describe("GitHubService.createPullRequest", () => {
  it("turns the no-commits-between GitHub error into a refresh hint", async () => {
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
        expect(failure.value.message).toContain('Run "jjacks refresh" and then sync again.');
        expect(failure.value.message).toContain("no commits between them");
      }
    }
  });
});
