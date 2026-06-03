import { Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";

import { CliError } from "./errors.js";
import { resolveSyncMode } from "./sync-mode.js";
import { renderDoctor, renderStatus, renderSyncPlan } from "./text.js";
import { GitHubServiceLive } from "./services/GitHubService.js";
import { JjServiceLive } from "./services/JjService.js";
import { ProcessServiceLive } from "./services/ProcessService.js";
import { RepoServiceLive } from "./services/RepoService.js";
import { StackService, StackServiceLive } from "./services/StackService.js";

const sharedLayer = Layer.mergeAll(
  ProcessServiceLive,
  RepoServiceLive,
  JjServiceLive,
  GitHubServiceLive,
  StackServiceLive
);

const doctor = Command.make("doctor", {}, () =>
  Effect.gen(function* () {
    const stackService = yield* StackService;
    const status = yield* stackService.getStatus;

    yield* Console.log(
      renderDoctor([
        `repo root: ${status.repoRoot}`,
        `current stack entries: ${status.entries.length}`,
        ...status.entries.map(({ entry, pullRequest }) =>
          `${entry.name}: branch ${entry.branchName}${pullRequest === null ? ", no PR yet" : `, PR #${pullRequest.number}`}`
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
    const plan = yield* stackService.buildSyncPlan;
    const mode = resolveSyncMode({ execute, dryRun });

    if (mode === "execute") {
      yield* Console.log(`${renderSyncPlan(plan)}\n\nexecute mode is not implemented yet; planning only for now`);
      return;
    }

    yield* Console.log(renderSyncPlan(plan));
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
