import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { Cause, Context, Effect, Exit, Layer } from "effect";
import * as Schema from "effect/Schema";

const OptionalString = Schema.optionalWith(Schema.UndefinedOr(Schema.String), { exact: true });

export const TelemetryStatus = Schema.Literal("success", "failure").annotations({
  identifier: "TelemetryStatus",
});
export type TelemetryStatus = Schema.Schema.Type<typeof TelemetryStatus>;

export const TelemetryStepTiming = Schema.Struct({
  name: Schema.String,
  label: Schema.String,
  startedAt: Schema.String,
  durationMs: Schema.Number,
  status: TelemetryStatus,
  error: OptionalString,
}).annotations({ identifier: "TelemetryStepTiming" });
export type TelemetryStepTiming = Schema.Schema.Type<typeof TelemetryStepTiming>;

export const TelemetryProcessTiming = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  startedAt: Schema.String,
  durationMs: Schema.Number,
  exitCode: Schema.NullOr(Schema.Number),
  status: TelemetryStatus,
  cwd: OptionalString,
  error: OptionalString,
}).annotations({ identifier: "TelemetryProcessTiming" });
export type TelemetryProcessTiming = Schema.Schema.Type<typeof TelemetryProcessTiming>;

export const TelemetryCommandRecord = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  runId: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String),
  repoRoot: Schema.String,
  startedAt: Schema.String,
  durationMs: Schema.Number,
  status: TelemetryStatus,
  error: OptionalString,
  steps: Schema.Array(TelemetryStepTiming),
  processes: Schema.Array(TelemetryProcessTiming),
}).annotations({ identifier: "TelemetryCommandRecord" });
export type TelemetryCommandRecord = Schema.Schema.Type<typeof TelemetryCommandRecord>;

export interface TelemetryServiceApi {
  readonly withCommand: <A, E, R>(
    options: {
      readonly command: string;
      readonly args: ReadonlyArray<string>;
    },
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  readonly timeStep: <A, E, R>(
    options: {
      readonly name: string;
      readonly label: string;
    },
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export class TelemetryService extends Context.Tag("TelemetryService")<
  TelemetryService,
  TelemetryServiceApi
>() {}

interface ActiveTelemetryRun {
  readonly runId: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly repoRoot: string;
  readonly startedAtMs: number;
  readonly startedAt: string;
  readonly steps: Array<TelemetryStepTiming>;
  readonly processes: Array<TelemetryProcessTiming>;
}

interface TelemetryRuntime {
  readonly cwd: () => string;
  readonly now: () => number;
  readonly randomId: () => string;
  readonly writeLine: (repoRoot: string, line: string) => void;
}

export const ProcessTimingInput = Schema.Struct({
  command: Schema.String,
  args: Schema.Array(Schema.String),
  startedAtMs: Schema.Number,
  finishedAtMs: Schema.Number,
  exitCode: Schema.NullOr(Schema.Number),
  status: TelemetryStatus,
  cwd: OptionalString,
  error: OptionalString,
}).annotations({ identifier: "ProcessTimingInput" });
export type ProcessTimingInput = Schema.Schema.Type<typeof ProcessTimingInput>;

export const telemetryDirectory = ".jjacks/telemetry";
export const telemetryJsonlPath = `${telemetryDirectory}/commands.jsonl`;

let activeRun: ActiveTelemetryRun | undefined;

const findRepoRoot = (cwd: string): string => {
  let current = path.resolve(cwd);

  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(cwd);
    }
    current = parent;
  }
};

const defaultWriteLine = (repoRoot: string, line: string): void => {
  const directory = path.join(repoRoot, telemetryDirectory);
  fs.mkdirSync(directory, { recursive: true });
  fs.appendFileSync(path.join(repoRoot, telemetryJsonlPath), `${line}\n`, "utf8");
};

const defaultRuntime: TelemetryRuntime = {
  cwd: () => process.cwd(),
  now: () => Date.now(),
  randomId: () => randomUUID(),
  writeLine: defaultWriteLine,
};

const formatCause = <E>(cause: Cause.Cause<E>): string => Cause.pretty(cause);

const statusForExit = <A, E>(exit: Exit.Exit<A, E>): TelemetryStatus =>
  Exit.isSuccess(exit) ? "success" : "failure";

const startedAtFromMs = (startedAtMs: number): string => new Date(startedAtMs).toISOString();

const recordLine = (runtime: TelemetryRuntime, record: TelemetryCommandRecord): void => {
  try {
    runtime.writeLine(record.repoRoot, JSON.stringify(record));
  } catch {
    // Telemetry must never change command behavior.
  }
};

export const recordProcessTiming = (input: ProcessTimingInput): void => {
  if (activeRun === undefined) {
    return;
  }

  activeRun.processes.push({
    command: input.command,
    args: input.args,
    startedAt: startedAtFromMs(input.startedAtMs),
    durationMs: Math.max(0, input.finishedAtMs - input.startedAtMs),
    exitCode: input.exitCode,
    status: input.status,
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(input.error === undefined ? {} : { error: input.error }),
  });
};

export const makeTelemetryService = (
  runtimeOverrides: Partial<TelemetryRuntime> = {},
): TelemetryServiceApi => {
  const runtime: TelemetryRuntime = {
    ...defaultRuntime,
    ...runtimeOverrides,
  };

  return {
    withCommand: (options, effect) =>
      Effect.gen(function* () {
        const previousRun = activeRun;
        const startedAtMs = runtime.now();
        const run: ActiveTelemetryRun = {
          runId: runtime.randomId(),
          command: options.command,
          args: options.args,
          repoRoot: findRepoRoot(runtime.cwd()),
          startedAtMs,
          startedAt: startedAtFromMs(startedAtMs),
          steps: [],
          processes: [],
        };

        activeRun = run;
        const exit = yield* Effect.exit(effect);
        const finishedAtMs = runtime.now();
        activeRun = previousRun;

        const record: TelemetryCommandRecord = {
          schemaVersion: 1,
          runId: run.runId,
          command: run.command,
          args: run.args,
          repoRoot: run.repoRoot,
          startedAt: run.startedAt,
          durationMs: Math.max(0, finishedAtMs - run.startedAtMs),
          status: statusForExit(exit),
          ...(Exit.isSuccess(exit) ? {} : { error: formatCause(exit.cause) }),
          steps: run.steps,
          processes: run.processes,
        };
        recordLine(runtime, record);

        if (Exit.isSuccess(exit)) {
          return exit.value;
        }

        return yield* Effect.failCause(exit.cause);
      }),

    timeStep: (options, effect) =>
      Effect.gen(function* () {
        const startedAtMs = runtime.now();
        const exit = yield* Effect.exit(effect);
        const finishedAtMs = runtime.now();

        if (activeRun !== undefined) {
          activeRun.steps.push({
            name: options.name,
            label: options.label,
            startedAt: startedAtFromMs(startedAtMs),
            durationMs: Math.max(0, finishedAtMs - startedAtMs),
            status: statusForExit(exit),
            ...(Exit.isSuccess(exit) ? {} : { error: formatCause(exit.cause) }),
          });
        }

        if (Exit.isSuccess(exit)) {
          return exit.value;
        }

        return yield* Effect.failCause(exit.cause);
      }),
  };
};

export const TelemetryServiceLive = Layer.succeed(TelemetryService, makeTelemetryService());
