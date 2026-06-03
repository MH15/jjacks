import { Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";

import { CliError } from "./errors";
import { renderStackComment } from "./stack";
import { resolveSyncMode } from "./sync-mode";
import { renderDoctor, renderExecuteSummary, renderStatus, renderSyncPreview } from "./text";
import { GitServiceLive } from "./services/GitService";
import { GitHubServiceLive } from "./services/GitHubService";
import { JjService, JjServiceLive } from "./services/JjService";
import { ProcessServiceLive } from "./services/ProcessService";
import { RepoServiceLive } from "./services/RepoService";
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

const execute = Options.boolean("execute").pipe(
  Options.withDescription("Apply sync actions after planning. Without this flag, sync stays in dry-run mode.")
);
const dryRun = Options.boolean("dry-run").pipe(
  Options.withDescription("Print the sync plan explicitly. This is also the default when --execute is not passed.")
);

const sync = Command.make("sync", { execute, dryRun }, ({ execute, dryRun }) =>
  Effect.gen(function* () {
    const stackService = yield* StackService;
    const mode = resolveSyncMode({ execute, dryRun });

    if (mode === "execute") {
      const result = yield* stackService.executeSync;
      const preview = renderSyncPreview(result.plan, renderStackComment(result.statusEntries));
      yield* Console.log(`${preview}\n\n${renderExecuteSummary(result)}`);
      return;
    }

    const status = yield* stackService.getStatus;
    const plan = yield* stackService.buildSyncPlan;
    const preview = renderSyncPreview(plan, renderStackComment(status.entries));
    yield* Console.log(preview);
  })
);

const root = Command.make("jjacks", {}, () => Console.log("Use a subcommand."))
  .pipe(Command.withSubcommands([doctor, status, sync]));

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
