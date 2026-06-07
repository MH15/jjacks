import { Args, Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { confirm, select } from "@inquirer/prompts";
import chalk from "chalk";
import { Console, Effect, Layer, Option } from "effect";

import { resolveDiffFormat } from "./diff";
import { CliError } from "./errors";
import { resolveBookmarkMovePlan } from "./navigation";
import { renderRefreshSummary, resolveRefreshPlan } from "./refresh";
import { buildSyncPlanFromStatus } from "./stack";
import { resolveSyncMode } from "./sync-mode";
import { renderDoctor, renderExecuteSummary, renderStatus, renderSyncPreview } from "./text";
import { GitServiceLive } from "./services/GitService";
import { GitHubServiceLive } from "./services/GitHubService";
import { JjService, JjServiceLive } from "./services/JjService";
import { ProgressService, ProgressServiceLive, type ProgressServiceApi } from "./services/ProgressService";
import { ProcessServiceLive } from "./services/ProcessService";
import { RepoService, RepoServiceLive } from "./services/RepoService";
import { StackService, StackServiceLive } from "./services/StackService";

const sharedLayer = Layer.mergeAll(
  ProcessServiceLive,
  RepoServiceLive,
  JjServiceLive,
  GitServiceLive,
  GitHubServiceLive,
  ProgressServiceLive,
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
).pipe(Command.withDescription("Check repo state, required jj config, and current stack/PR wiring."));

const status = Command.make("status", {}, () =>
  Effect.gen(function* () {
    const stackService = yield* StackService;
    const result = yield* stackService.getStatus;
    yield* Console.log(renderStatus(result.repoRoot, result.entries));
  })
).pipe(Command.withDescription("Show the active bookmark stack, push state, and PR mapping."));

const bookmarkName = Args.text({ name: "bookmark-name" }).pipe(
  Args.withDescription("Bookmark name to create for the new stacked change.")
);

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
).pipe(Command.withDescription("Open a new child jj change and bookmark it as the next stacked PR."));

const promptError = (context: string, error: unknown): CliError => {
  if (error instanceof CliError) {
    return error;
  }

  if (error instanceof Error && error.name === "ExitPromptError") {
    return new CliError(`${context} canceled.`);
  }

  return new CliError(`${context} failed${error instanceof Error && error.message.length > 0 ? `: ${error.message}` : "."}`);
};

const ensureInteractiveTerminal = (action: string) =>
  !process.stdin.isTTY || !process.stdout.isTTY
    ? Effect.fail(new CliError(`${action} requires an interactive terminal so you can choose from multiple child bookmarks.`))
    : Effect.void;

const promptForChildBookmark = (parentBookmarkName: string, childBookmarkNames: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: () =>
      select({
        message: `Choose the child bookmark to continue from ${parentBookmarkName}`,
        choices: childBookmarkNames.map((childBookmarkName) => ({
          name: childBookmarkName,
          value: childBookmarkName
        }))
      }, {
        clearPromptOnDone: true
      }),
    catch: (error) => promptError(`Choosing a child bookmark from ${parentBookmarkName}`, error)
  });

const runMoveCommand = <R>(
  direction: "up" | "down",
  move: Effect.Effect<string, CliError, R>
) =>
  Effect.gen(function* () {
    const workingCopyLog = yield* move;
    yield* Console.log([`jjacks ${direction}`, "", "current jj state", workingCopyLog].join("\n"));
  });

const noActiveBookmarkStackError = () =>
  new CliError("No active bookmark stack found. Run `jjacks create <bookmark-name>` first.");

const noTargetBookmarkError = (
  direction: "up" | "down",
  currentBookmarkName: string
) =>
  new CliError(
    direction === "up"
      ? `No child bookmarks found from ${currentBookmarkName}.`
      : `No parent bookmark found from ${currentBookmarkName}.`
  );

const resolveBookmarkMove = (direction: "up" | "down") => Effect.gen(function* () {
  const jjService = yield* JjService;
  const trackedBookmarks = yield* jjService.getTrackedBookmarks;
  const movePlan = resolveBookmarkMovePlan(direction, trackedBookmarks);

  switch (movePlan.kind) {
    case "no-current-bookmark":
      return yield* Effect.fail(noActiveBookmarkStackError());
    case "no-target-bookmark":
      return yield* Effect.fail(noTargetBookmarkError(direction, movePlan.currentBookmarkName));
    case "move-to-bookmark":
      return jjService.moveToBookmark(movePlan.bookmarkName);
    case "choose-child-bookmark":
      return Effect.gen(function* () {
        yield* ensureInteractiveTerminal(`Moving up from ${movePlan.parentBookmarkName}`);
        const selectedChildBookmark = yield* promptForChildBookmark(
          movePlan.parentBookmarkName,
          movePlan.childBookmarkNames
        );
        return yield* jjService.moveToBookmark(selectedChildBookmark);
      });
  }
});

const up = Command.make("up", {}, () =>
  Effect.gen(function* () {
    const move = yield* resolveBookmarkMove("up");
    yield* runMoveCommand("up", move);
  })
).pipe(Command.withDescription("Move to the next bookmark in the current bookmark stack."));

const u = Command.make("u", {}, () =>
  Effect.gen(function* () {
    const move = yield* resolveBookmarkMove("up");
    yield* runMoveCommand("up", move);
  })
).pipe(Command.withDescription("Alias for `up`."));

const down = Command.make("down", {}, () =>
  Effect.gen(function* () {
    const move = yield* resolveBookmarkMove("down");
    yield* runMoveCommand("down", move);
  })
).pipe(Command.withDescription("Move to the previous bookmark in the current bookmark stack."));

const d = Command.make("d", {}, () =>
  Effect.gen(function* () {
    const move = yield* resolveBookmarkMove("down");
    yield* runMoveCommand("down", move);
  })
).pipe(Command.withDescription("Alias for `down`."));

const refresh = Command.make("refresh", {}, () =>
  Effect.gen(function* () {
    const repoService = yield* RepoService;
    const jjService = yield* JjService;
    const stackService = yield* StackService;
    yield* repoService.fetchOrigin;
    const repoInfo = yield* repoService.getRepoInfo;
    const defaultBranch = repoInfo.defaultBranch ?? "main";
    yield* jjService.syncBookmarkToRemote(defaultBranch);

    const status = yield* stackService.getStatus;
    const plan = resolveRefreshPlan(status.entries, defaultBranch);
    const workingCopyLog =
      plan.kind === "clean-trunk"
        ? yield* jjService.startWorkingCopyOnBookmark({
            bookmarkName: defaultBranch,
            message: "Start next change from main"
          })
        : yield* jjService.continueWorkingCopyOnStack({
            rootBookmarkName: plan.rootBookmarkName,
            tipBookmarkName: plan.tipBookmarkName,
            defaultBranch,
            message: `Continue ${plan.tipBookmarkName}`
          });

    yield* Console.log(renderRefreshSummary(plan, workingCopyLog, { color: true }));
  })
).pipe(
  Command.withDescription("Refresh trunk, restack surviving bookmarks onto it, and continue the remaining stack.")
);

const active = Options.boolean("active").pipe(
  Options.withDescription("Show only the current active lane from trunk to @.")
);
const bookmarksOnly = Options.boolean("bookmarks-only").pipe(
  Options.withDescription("Show only bookmarked descendants above trunk.")
);
const noGraph = Options.boolean("no-graph").pipe(
  Options.withDescription("Pass through to `jj log --no-graph`.")
);

const log = Command.make("log", { active, bookmarksOnly, noGraph }, ({ active, bookmarksOnly, noGraph }) =>
  Effect.gen(function* () {
    if (active && bookmarksOnly) {
      return yield* Effect.fail(new CliError("Choose at most one log scope flag: --active or --bookmarks-only."));
    }

    const jjService = yield* JjService;
    const output = yield* jjService.logBookmarks({
      mode: active ? "active" : bookmarksOnly ? "bookmarks-only" : "tree",
      noGraph
    });

    yield* Console.log(output);
  })
).pipe(Command.withDescription("Show the tracked jj work tree above trunk using the jjacks sync model."));

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
).pipe(Command.withDescription("Diff the current stacked change against its parent bookmark or another revset."));

const execute = Options.boolean("execute").pipe(
  Options.withDescription("Apply sync actions immediately without an interactive confirmation prompt.")
);
const dryRun = Options.boolean("dry-run").pipe(
  Options.withDescription("Print the sync plan without applying it.")
);

const promptForSyncConfirmation = Effect.tryPromise({
  try: () =>
    confirm({
      message: "Apply this sync plan?",
      default: true
    }, {
      clearPromptOnDone: true
    }),
  catch: (error) => promptError("Sync confirmation", error)
});

const syncStepTitles = {
  inspect: "Inspect stack",
  descriptions: "Fill blank descriptions",
  pushes: "Push bookmarks",
  pullRequests: "Reconcile pull requests",
  comments: "Sync stack comments"
} as const;

const pendingLabels = (labels: ReadonlyArray<string>, startIndex: number): ReadonlyArray<string> => labels.slice(startIndex + 1);

const runStep = <A, E extends CliError, R>(
  progress: ProgressServiceApi,
  options: {
    readonly pending: ReadonlyArray<string>;
    readonly start: string;
    readonly done: (value: A) => string;
    readonly fail?: (error: E) => string;
  },
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    yield* progress.startChecklist({
      current: options.start,
      pending: options.pending
    });

    const result = yield* effect.pipe(
      Effect.tapError((error) => progress.failCurrent(options.fail?.(error) ?? `${options.start}: ${error.message}`))
    );

    yield* progress.persistSuccess(options.done(result));
    return result;
  });

const sync = Command.make("sync", { execute, dryRun }, ({ execute, dryRun }) =>
  Effect.gen(function* () {
    const stackService = yield* StackService;
    const progress = yield* ProgressService;
    const mode = resolveSyncMode({ execute, dryRun });
    const renderColored = mode === "confirm";
    const runExecute = (
      preparedOverride?: {
        readonly defaultBranch: string;
        readonly entries: ReadonlyArray<import("./domain").StackStatusEntry>;
      }
    ) =>
      Effect.gen(function* () {
      const labels = [
        syncStepTitles.inspect,
        syncStepTitles.descriptions,
        syncStepTitles.pushes,
        syncStepTitles.pullRequests,
        syncStepTitles.comments
      ] as const;

      yield* progress.persistSuccess(`Apply this sync plan? ${chalk.cyan("Yes")}`);

      const prepared =
        preparedOverride ??
        (yield* runStep(
          progress,
          {
            start: syncStepTitles.inspect,
            pending: pendingLabels(labels, 0),
            done: ({ entries }) => `Inspect stack (${entries.length} entr${entries.length === 1 ? "y" : "ies"})`
          },
          stackService.prepareSync
        ));

      if (prepared.entries.length === 0) {
        const result = yield* stackService.executeSync;
        const preview = renderSyncPreview(result.plan, { color: renderColored });
        yield* Console.log(`${preview}\n\n${renderExecuteSummary(result)}`);
        return;
      }

      const descriptions = yield* runStep(
        progress,
        {
          start: syncStepTitles.descriptions,
          pending: pendingLabels(labels, 1),
          done: ({ describedBookmarks }) =>
            describedBookmarks.length === 0
              ? `${syncStepTitles.descriptions} (none needed)`
              : `${syncStepTitles.descriptions} (${describedBookmarks.length})`
        },
        stackService.ensureSyncDescriptions(prepared.entries)
      );

      const pushes = yield* runStep(
        progress,
        {
          start: syncStepTitles.pushes,
          pending: pendingLabels(labels, 2),
          done: ({ pushedBookmarks }) =>
            pushedBookmarks.length === 0
              ? `${syncStepTitles.pushes} (none needed)`
              : `${syncStepTitles.pushes} (${pushedBookmarks.length})`
        },
        stackService.pushSyncBookmarks(descriptions.entries)
      );

      const prs = yield* runStep(
        progress,
        {
          start: syncStepTitles.pullRequests,
          pending: pendingLabels(labels, 3),
          done: ({ createdPullRequestBookmarks, updatedPullRequestNumbers }) => {
            const pullRequestChanges = createdPullRequestBookmarks.length + updatedPullRequestNumbers.length;
            return pullRequestChanges === 0
              ? `${syncStepTitles.pullRequests} (no metadata changes)`
              : `${syncStepTitles.pullRequests} (${pullRequestChanges})`;
          }
        },
        stackService.reconcileSyncPullRequests({
          entries: pushes.entries,
          defaultBranch: prepared.defaultBranch
        })
      );

      const comments = yield* runStep(
        progress,
        {
          start: syncStepTitles.comments,
          pending: pendingLabels(labels, 4),
          done: ({ updatedCommentPullRequestNumbers, warnings }) =>
            warnings.length === 0
              ? `${syncStepTitles.comments} (${updatedCommentPullRequestNumbers.length})`
              : `${syncStepTitles.comments} (${updatedCommentPullRequestNumbers.length}, ${warnings.length} warnings)`
        },
        stackService.syncStackComments(prs.entries)
      );

      const result = {
        pushedBookmarks: pushes.pushedBookmarks,
        createdPullRequestBookmarks: prs.createdPullRequestBookmarks,
        updatedPullRequestNumbers: prs.updatedPullRequestNumbers,
        updatedCommentPullRequestNumbers: comments.updatedCommentPullRequestNumbers,
        warnings: comments.warnings,
        plan: prs.plan,
        statusEntries: prs.entries
      };
      const preview = renderSyncPreview(result.plan, { color: renderColored });
      yield* Console.log(`${preview}\n\n${renderExecuteSummary(result)}`);
    });

    if (mode === "execute") {
      yield* runExecute();
      return;
    }

    const prepared = yield* stackService.prepareSync;
    const plan = buildSyncPlanFromStatus(prepared.entries, prepared.defaultBranch);
    const preview = renderSyncPreview(plan, { color: renderColored });
    yield* Console.log(preview);

    if (mode === "dry-run") {
      return;
    }

    const confirmed = yield* promptForSyncConfirmation;
    if (!confirmed) {
      yield* Console.log("sync canceled");
      return;
    }

    yield* runExecute(prepared);
  })
).pipe(
  Command.withDescription("Preview and sync the current bookmark stack to GitHub pull requests and stack comments.")
);

const root = Command.make("jjacks", {}, () => Console.log("Use a subcommand."))
  .pipe(Command.withDescription("Sync the current jj bookmark stack to GitHub in a Graphite-like workflow."))
  .pipe(Command.withSubcommands([doctor, status, create, up, u, down, d, refresh, log, diff, sync]));

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
