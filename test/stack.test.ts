import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import type { RepoInfo, StackEntry } from "../src/domain.js";
import { renderStackComment, stackCommentMarker } from "../src/stack.js";
import { GitHubService } from "../src/services/GitHubService.js";
import { JjService } from "../src/services/JjService.js";
import { ProcessService } from "../src/services/ProcessService.js";
import { RepoService } from "../src/services/RepoService.js";
import { StackService, StackServiceLive } from "../src/services/StackService.js";

const stack: ReadonlyArray<StackEntry> = [
  {
    name: "feat/base",
    changeId: "aaa111",
    commitId: "111aaa",
    parentBookmarkName: undefined,
    branchName: "jj/feat/base"
  },
  {
    name: "feat/ui",
    changeId: "bbb222",
    commitId: "222bbb",
    parentBookmarkName: "feat/base",
    branchName: "jj/feat/ui"
  }
];

const repoInfo: RepoInfo = {
  root: "/tmp/repo",
  gitRemote: "https://github.com/MH15/jjacks.git",
  defaultBranch: "main"
};

const makeLayer = () => {
  const jjLayer = Layer.succeed(JjService, {
    getCurrentStack: Effect.succeed(stack)
  });

  const repoLayer = Layer.succeed(RepoService, {
    getRepoInfo: Effect.succeed(repoInfo)
  });

  const githubLayer = Layer.succeed(GitHubService, {
    findPullRequestByHead: (branchName: string) =>
      Effect.succeed(
        branchName === "jj/feat/base"
          ? {
              number: 12,
              url: "https://github.com/MH15/jjacks/pull/12",
              title: "feat/base",
              headRefName: "jj/feat/base",
              baseRefName: "main",
              isDraft: false
            }
          : null
      )
  });

  const processLayer = Layer.succeed(ProcessService, {
    run: () =>
      Effect.die("ProcessService should not be used when fake JJ/GitHub/Repo services are provided.")
  });

  return Layer.mergeAll(jjLayer, repoLayer, githubLayer, processLayer, StackServiceLive);
};

describe("StackService with injected fakes", () => {
  it("builds a sync plan using DI-provided services", async () => {
    const plan = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.buildSyncPlan;
      }).pipe(Effect.provide(makeLayer()))
    );

    expect(plan.stack).toHaveLength(2);
    expect(plan.stack[0]).toMatchObject({
      intendedBaseBranch: "main"
    });
    expect(plan.stack[0]?.actions).not.toContainEqual(expect.stringContaining('create PR titled "feat/base"'));
    expect(plan.stack[1]).toMatchObject({
      intendedBaseBranch: "jj/feat/base"
    });
    expect(plan.stack[1]?.actions).toContain('create PR titled "feat/ui" with base jj/feat/base');
  });

  it("returns repo-scoped status entries with PR lookup results", async () => {
    const status = await Effect.runPromise(
      Effect.gen(function* () {
        const stackService = yield* StackService;
        return yield* stackService.getStatus;
      }).pipe(Effect.provide(makeLayer()))
    );

    expect(status.repoRoot).toBe("/tmp/repo");
    expect(status.entries[0]?.pullRequest?.number).toBe(12);
    expect(status.entries[1]?.pullRequest).toBeNull();
  });
});

describe("renderStackComment", () => {
  it("renders a stable comment body with current marker and pending PRs", () => {
    const comment = renderStackComment([
      {
        entry: stack[0]!,
        pullRequest: {
          number: 12,
          url: "https://github.com/MH15/jjacks/pull/12",
          title: "feat/base",
          headRefName: "jj/feat/base",
          baseRefName: "main",
          isDraft: false
        }
      },
      {
        entry: stack[1]!,
        pullRequest: null
      }
    ]);

    expect(comment).toContain(stackCommentMarker);
    expect(comment).toContain("[#12](https://github.com/MH15/jjacks/pull/12) `feat/base`");
    expect(comment).toContain("**current** `feat/ui` -> pending PR");
  });
});
