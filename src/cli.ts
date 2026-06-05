import { Args, Command, Options } from "@effect/cli";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { Console, Effect, Layer, Option } from "effect";

import { resolveDiffFormat } from "./diff";
import { CliError } from "./errors";
import { renderRefreshSummary, resolveRefreshPlan } from "./refresh";
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

const up = Command.make("up", {}, () =>
  Effect.gen(function* () {
    const jjService = yield* JjService;
    const workingCopyLog = yield* jjService.moveUp;
    yield* Console.log(["jjacks up", "", "current jj state", workingCopyLog].join("\n"));
  })
).pipe(Command.withDescription("Move up the current bookmark stack with `jj next`."));

const down = Command.make("down", {}, () =>
  Effect.gen(function* () {
    const jjService = yield* JjService;
    const workingCopyLog = yield* jjService.moveDown;
    yield* Console.log(["jjacks down", "", "current jj state", workingCopyLog].join("\n"));
  })
).pipe(Command.withDescription("Move down the current bookmark stack with `jj prev`."));

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

    yield* Console.log(renderRefreshSummary(plan, workingCopyLog));
  })
).pipe(
  Command.withDescription("Refresh trunk, restack surviving bookmarks onto it, and continue the remaining stack.")
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
).pipe(Command.withDescription("Diff the current stacked change against its parent bookmark or another revset."));

const execute = Options.boolean("execute").pipe(
  Options.withDescription("Apply sync actions immediately without an interactive confirmation prompt.")
);
const dryRun = Options.boolean("dry-run").pipe(
  Options.withDescription("Print the sync plan without applying it.")
);

const promptForSyncConfirmation = Effect.promise(() =>
  confirm({
    message: "Apply this sync plan?",
    default: true
  }, {
    clearPromptOnDone: true
  })
);

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
    const runExecute = Effect.gen(function* () {
      const labels = [
        syncStepTitles.inspect,
        syncStepTitles.descriptions,
        syncStepTitles.pushes,
        syncStepTitles.pullRequests,
        syncStepTitles.comments
      ] as const;

      yield* progress.persistSuccess(`Apply this sync plan? ${chalk.cyan("Yes")}`);

      const prepared = yield* runStep(
        progress,
        {
          start: syncStepTitles.inspect,
          pending: pendingLabels(labels, 0),
          done: ({ entries }) => `Inspect stack (${entries.length} entr${entries.length === 1 ? "y" : "ies"})`
        },
        stackService.prepareSync
      );

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
      yield* runExecute;
      return;
    }

    const plan = yield* stackService.buildSyncPlan;
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

    yield* runExecute;
  })
).pipe(
  Command.withDescription("Preview and sync the current bookmark stack to GitHub pull requests and stack comments.")
);

const root = Command.make("jjacks", {}, () => Console.log("Use a subcommand."))
  .pipe(Command.withDescription("Sync the current jj bookmark stack to GitHub in a Graphite-like workflow."))
  .pipe(Command.withSubcommands([doctor, status, create, up, down, refresh, diff, sync]));

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
