import { Context, Effect, Layer } from "effect";
import ora, { type Ora } from "ora";

export interface ProgressServiceApi {
  readonly startChecklist: (options: {
    readonly current: string;
    readonly pending: ReadonlyArray<string>;
  }) => Effect.Effect<void>;
  readonly persistSuccess: (message: string) => Effect.Effect<void>;
  readonly failCurrent: (message: string) => Effect.Effect<void>;
  readonly clear: Effect.Effect<void>;
}

export class ProgressService extends Context.Tag("ProgressService")<
  ProgressService,
  ProgressServiceApi
>() {}

const formatElapsed = (elapsedMs: number): string =>
  elapsedMs < 1000 ? `${elapsedMs}ms` : `${(elapsedMs / 1000).toFixed(1)}s`;

const renderChecklist = (
  current: string,
  pending: ReadonlyArray<string>,
  elapsedMs?: number
): string =>
  [
    elapsedMs === undefined ? current : `${current} ${formatElapsed(elapsedMs)}`,
    ...pending.map((label) => `- ${label}`)
  ].join("\n");

let currentStartedAt: number | undefined;
let currentLabel: string | undefined;
let currentPending: ReadonlyArray<string> = [];
let timer: ReturnType<typeof setInterval> | undefined;

const clearTimer = (): void => {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
};

const currentElapsedMs = (): number | undefined =>
  currentStartedAt === undefined ? undefined : Math.max(0, Date.now() - currentStartedAt);

const renderCurrentChecklist = (): void => {
  if (currentLabel === undefined) {
    return;
  }

  spinner.text = renderChecklist(currentLabel, currentPending, currentElapsedMs());
};

const stopTiming = (): number | undefined => {
  const elapsedMs = currentElapsedMs();
  clearTimer();
  currentStartedAt = undefined;
  currentLabel = undefined;
  currentPending = [];
  return elapsedMs;
};

const withElapsed = (message: string, elapsedMs: number | undefined): string =>
  elapsedMs === undefined ? message : `${message} ${formatElapsed(elapsedMs)}`;

const make: ProgressServiceApi = {
  startChecklist: ({
    current,
    pending
  }: {
    readonly current: string;
    readonly pending: ReadonlyArray<string>;
  }) =>
    Effect.sync(() => {
      clearTimer();
      currentStartedAt = Date.now();
      currentLabel = current;
      currentPending = pending;
      renderCurrentChecklist();
      if (!spinner.isSpinning) {
        spinner.start();
      }
      timer = setInterval(() => {
        renderCurrentChecklist();
      }, 100);
    }),

  persistSuccess: (message: string) =>
    Effect.sync(() => {
      const elapsedMs = stopTiming();
      spinner.stopAndPersist({
        symbol: "✔",
        text: withElapsed(message, elapsedMs)
      });
    }),

  failCurrent: (message: string) =>
    Effect.sync(() => {
      const elapsedMs = stopTiming();
      spinner.fail(withElapsed(message, elapsedMs));
    }),

  clear: Effect.sync(() => {
    stopTiming();
    spinner.stop();
  })
};

const spinner: Ora = ora({
  discardStdin: false
});

export const ProgressServiceLive = Layer.effect(ProgressService, Effect.succeed(make));
