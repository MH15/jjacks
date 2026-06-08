import path from "node:path";

import { Context, Effect, Layer, ParseResult, Schema } from "effect";

import { RepoInfo, type RepoInfo as RepoInfoType } from "../domain";
import { CliError } from "../errors";
import { ProcessService } from "./ProcessService";

export class RepoService extends Context.Tag("RepoService")<
  RepoService,
  {
    readonly fetchOrigin: Effect.Effect<void, CliError, ProcessService>;
    readonly findRemoteHead: (
      branchName: string,
    ) => Effect.Effect<string | undefined, CliError, ProcessService>;
    readonly getRepoInfo: Effect.Effect<RepoInfoType, CliError, ProcessService>;
  }
>() {}

const decodeWithSchema = <A, I>(schema: Schema.Schema<A, I>, value: unknown, context: string) =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(
      (error) => new CliError(`${context}\n${ParseResult.TreeFormatter.formatErrorSync(error)}`),
    ),
  );

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

  findRemoteHead: (branchName: string) =>
    Effect.gen(function* () {
      const process = yield* ProcessService;
      const result = yield* process.run("git", ["ls-remote", "--heads", "origin", branchName], {
        allowNonZeroExit: true,
      });

      if (result.exitCode !== 0) {
        return yield* Effect.fail(
          new CliError(
            [`Failed to inspect origin/${branchName}.`, result.stderr, result.stdout]
              .filter(Boolean)
              .join("\n"),
          ),
        );
      }

      const firstLine = result.stdout.split("\n").find(Boolean);
      if (firstLine === undefined) {
        return undefined;
      }

      const [commitId] = firstLine.split(/\s+/);
      return commitId;
    }),

  getRepoInfo: Effect.gen(function* () {
    const process = yield* ProcessService;

    const root = yield* process.run("git", ["rev-parse", "--show-toplevel"]);
    const remote = yield* process.run("git", ["remote", "-v"], {
      allowNonZeroExit: true,
    });
    const defaultBranch = yield* process.run(
      "git",
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      {
        allowNonZeroExit: true,
      },
    );

    return yield* decodeWithSchema(
      RepoInfo,
      {
        root: path.resolve(root.stdout),
        ...(remote.exitCode === 0 && parseRemote(remote.stdout) !== undefined
          ? { gitRemote: parseRemote(remote.stdout) }
          : {}),
        ...(defaultBranch.exitCode === 0
          ? { defaultBranch: defaultBranch.stdout.replace(/^origin\//, "") }
          : {}),
      },
      "Failed to decode repo info",
    );
  }),
};

export const RepoServiceLive = Layer.succeed(RepoService, make);
