import path from "node:path";

import { Context, Effect, Layer } from "effect";

import type { RepoInfo } from "../domain";
import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class RepoService extends Context.Tag("RepoService")<
  RepoService,
  {
    readonly fetchOrigin: Effect.Effect<void, CliError, ProcessService>;
    readonly getRepoInfo: Effect.Effect<RepoInfo, CliError, ProcessService>;
  }
>() {}

const parseRemote = (stdout: string): string | undefined => {
  const firstLine = stdout.split("\n").find(Boolean);
  if (firstLine === undefined) {
    return undefined;
  }

  const [name, url] = firstLine.split("\t");
  if (name === undefined || url === undefined) {
    return undefined;
  }

  return url.replace(/\s+\(fetch\)$/, "");
};

const make = {
  fetchOrigin: Effect.gen(function* () {
    const process = yield* ProcessService;
    yield* process.run("git", ["fetch", "origin"]);
  }),

  getRepoInfo: Effect.gen(function* () {
    const process = yield* ProcessService;

    const root = yield* process.run("git", ["rev-parse", "--show-toplevel"]);
    const remote = yield* process.run("git", ["remote", "-v"], {
      allowNonZeroExit: true
    });
    const defaultBranch = yield* process.run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      allowNonZeroExit: true
    });

    const repoInfo: RepoInfo = {
      root: path.resolve(root.stdout),
      gitRemote: remote.exitCode === 0 ? parseRemote(remote.stdout) : undefined,
      defaultBranch:
        defaultBranch.exitCode === 0 ? defaultBranch.stdout.replace(/^origin\//, "") : undefined
    };

    return repoInfo;
  })
};

export const RepoServiceLive = Layer.effect(RepoService, Effect.succeed(make));
