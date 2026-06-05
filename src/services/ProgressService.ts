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

const renderChecklist = (current: string, pending: ReadonlyArray<string>): string =>
  [current, ...pending.map((label) => `- ${label}`)].join("\n");

const make: ProgressServiceApi = {
  startChecklist: ({
    current,
    pending
  }: {
    readonly current: string;
    readonly pending: ReadonlyArray<string>;
  }) =>
    Effect.sync(() => {
      spinner.text = renderChecklist(current, pending);
      if (!spinner.isSpinning) {
        spinner.start();
      }
    }),

  persistSuccess: (message: string) =>
    Effect.sync(() => {
      spinner.stopAndPersist({
        symbol: "✔",
        text: message
      });
    }),

  failCurrent: (message: string) =>
    Effect.sync(() => {
      spinner.fail(message);
    }),

  clear: Effect.sync(() => {
    spinner.stop();
  })
};

const spinner: Ora = ora({
  discardStdin: false
});

export const ProgressServiceLive = Layer.effect(ProgressService, Effect.succeed(make));
