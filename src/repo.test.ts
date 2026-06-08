import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import { RepoService, RepoServiceLive } from "../src/services/RepoService";
import { ProcessService } from "../src/services/ProcessService";

describe("RepoService.findRemoteHead", () => {
  it("returns the remote commit id for a branch", async () => {
    const processLayer = Layer.succeed(ProcessService, {
      run: (_command: string, args: ReadonlyArray<string>) => {
        expect(args).toEqual(["ls-remote", "--heads", "origin", "feat/coworker"]);
        return Effect.succeed({
          stdout: "abc123\trefs/heads/feat/coworker",
          stderr: "",
          exitCode: 0,
        });
      },
    });

    const commitId = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* RepoService;
        return yield* repo.findRemoteHead("feat/coworker");
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, RepoServiceLive))),
    );

    expect(commitId).toBe("abc123");
  });

  it("returns undefined when the branch is not found", async () => {
    const processLayer = Layer.succeed(ProcessService, {
      run: () =>
        Effect.succeed({
          stdout: "",
          stderr: "",
          exitCode: 0,
        }),
    });

    const commitId = await Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* RepoService;
        return yield* repo.findRemoteHead("feat/missing");
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, RepoServiceLive))),
    );

    expect(commitId).toBeUndefined();
  });
});
