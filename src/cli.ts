import { Args, Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Layer, Option } from "effect";
import { createInterface } from "node:readline/promises";

import { resolveDiffFormat } from "./diff";
import { CliError } from "./errors";
import { renderRefreshSummary } from "./refresh";
import { renderStackComment } from "./stack";
import { parseSyncConfirmation, resolveSyncMode } from "./sync-mode";
import { renderDoctor, renderExecuteSummary, renderStatus, renderSyncPreview } from "./text";
import { GitServiceLive } from "./services/GitService";
import { GitHubServiceLive } from "./services/GitHubService";
import { JjService, JjServiceLive } from "./services/JjService";
import { ProcessServiceLive } from "./services/ProcessService";
import { RepoService, RepoServiceLive } from "./services/RepoService";
import { StackService, StackServiceLive } from "./services/StackService";

const sharedLayer = Layer.mergeAll(
  ProcessServiceLive,
  RepoServiceLive,
  JjServiceLive,
  GitServiceLive,
  GitHubServiceLive,
  StackServiceLive
);

const doctor = Command.make("doctor", {}, () =>
  Effect.gen(function* () {
    const jjService = yield* JjService;
    const stackService = yield* StackService;
    yield* jjService.ensureAdvanceBookmarksEnabled;
    const status = yield* stackService.getStatus;

    yield* Console.log(
      renderDoctor([
        "advance-bookmarks.enabled: true",
        `repo root: ${status.repoRoot}`,
        `current stack entries: ${status.entries.length}`,
        ...(status.entries.length === 0 ? ["no active bookmark stack", "next: jjacks create <bookmark-name>"] : []),
        ...status.entries.map(({ entry, pullRequest, remoteBranchExists, needsBookmarkPush }) =>
          `${entry.name}: branch ${entry.branchName}, ${
            !remoteBranchExists ? "not pushed" : needsBookmarkPush ? "needs push" : "pushed"
          }${
            pullRequest === null ? ", no PR yet" : `, PR #${pullRequest.number}`
          }`
        )
      ])
    );
  })
);

const status = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const stackService = yield* StackService;
    const result = yield* stackService.getStatus;
    yield* Console.log(renderStatus(result.repoRoot, result.entries));
  })
);

const bookmarkName = Args.text({ name: "bookmark-name" });

const create = Command.make("create", { bookmarkName }, ({ bookmarkName }) =>
  Effect.gen(function* () {
    const jjService = yield* JjService;
    yield* jjService.createBookmark({
      bookmarkName,
      message: bookmarkName
    });
    yield* jjService.ensureBookmarkDescription(bookmarkName, bookmarkName);
    yield* Console.log(
      [
        `created bookmark ${bookmarkName}`,
        "next:",
        "  node dist/cli.js sync --dry-run"
      ].join("\n")
    );
  })
);

const refresh = Command.make("refresh", {}, () =>
  Effect.gen(function* () {
    const repoService = yield* RepoService;
    const jjService = yield* JjService;
    yield* repoService.fetchOrigin;
    const repoInfo = yield* repoService.getRepoInfo;
    const defaultBranch = repoInfo.defaultBranch ?? "main";
    const workingCopyLog = yield* jjService.refreshToRemoteBookmark({
      bookmarkName: defaultBranch,
      message: "Start next change from main"
    });
    yield* Console.log(renderRefreshSummary(defaultBranch, workingCopyLog));
  })
);

const against = Options.text("against").pipe(
  Options.optional,
  Options.withDescription("Show the diff against this revset instead of the parent bookmark.")
);
const summary = Options.boolean("summary").pipe(
  Options.withDescription("Show only the changed paths, like `jj diff --summary`.")
);
const stat = Options.boolean("stat").pipe(
  Options.withDescription("Show a histogram of the changes, like `jj diff --stat`.")
);

const diff = Command.make("diff", { against, summary, stat }, ({ against, summary, stat }) =>
  Effect.gen(function* () {
    const jjService = yield* JjService;
    const format = resolveDiffFormat({ summary, stat });
    const againstRevset = Option.getOrUndefined(against);
    const output = yield* jjService.diffCurrentStack({
      defaultBranch: "main",
      ...(againstRevset === undefined ? {} : { against: againstRevset }),
      format
    });

    yield* Console.log(output);
  })
);

const execute = Options.boolean("execute").pipe(
  Options.withDescription("Apply sync actions immediately without an interactive confirmation prompt.")
);
const dryRun = Options.boolean("dry-run").pipe(
  Options.withDescription("Print the sync plan without applying it.")
);

const promptForSyncConfirmation = Effect.gen(function* () {
  while (true) {
    const answer = yield* Effect.acquireUseRelease(
      Effect.sync(() => createInterface({ input: process.stdin, output: process.stdout })),
      (readline) => Effect.promise(() => readline.question("Apply this sync plan? [Y/n] ")),
      (readline) => Effect.sync(() => readline.close())
    );

    const parsed = parseSyncConfirmation(answer);
    if (parsed !== undefined) {
      return parsed;
    }

    yield* Console.log('Please answer "y" or "n".');
  }
});

const sync = Command.make("sync", { execute, dryRun }, ({ execute, dryRun }) =>
  Effect.gen(function* () {
    const stackService = yield* StackService;
    const mode = resolveSyncMode({ execute, dryRun });
    const runExecute = Effect.gen(function* () {
      const result = yield* stackService.executeSync;
      const preview = renderSyncPreview(result.plan, renderStackComment(result.statusEntries));
      yield* Console.log(`${preview}\n\n${renderExecuteSummary(result)}`);
    });

    if (mode === "execute") {
      yield* runExecute;
      return;
    }

    const status = yield* stackService.getStatus;
    const plan = yield* stackService.buildSyncPlan;
    const preview = renderSyncPreview(plan, renderStackComment(status.entries));
    yield* Console.log(preview);

    if (mode === "dry-run") {
      return;
    }

    const confirmed = yield* promptForSyncConfirmation;
    if (!confirmed) {
      yield* Console.log("sync canceled");
      return;
    }

    yield* runExecute;
  })
);

const root = Command.make("jjacks", {}, () => Console.log("Use a subcommand."))
  .pipe(Command.withSubcommands([doctor, status, create, refresh, diff, sync]));

const cli = Command.run(root, {
  name: "jjacks",
  version: "0.1.0"
});

cli(process.argv).pipe(
  Effect.catchIf(
    (error): error is CliError => error instanceof CliError,
    (error) => Console.error(error.message)
  ),
  Effect.provide(Layer.mergeAll(sharedLayer, NodeContext.layer)),
  NodeRuntime.runMain
);
