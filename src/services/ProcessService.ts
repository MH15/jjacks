import { spawn } from "node:child_process";

import { Context, Effect, Layer } from "effect";

import { CliError } from "../errors";

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export class ProcessService extends Context.Tag("ProcessService")<
  ProcessService,
  {
    readonly run: (
      command: string,
      args: ReadonlyArray<string>,
      options?: {
        readonly cwd?: string;
        readonly allowNonZeroExit?: boolean;
      }
    ) => Effect.Effect<ProcessResult, CliError>;
  }
>() {}

const make = {
  run: (
    command: string,
    args: ReadonlyArray<string>,
    options?: {
      readonly cwd?: string;
      readonly allowNonZeroExit?: boolean;
    }
  ) =>
    Effect.async<ProcessResult, CliError>((resume) => {
      const child = spawn(command, args, {
        cwd: options?.cwd,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let resolved = false;

      let stdout = "";
      let stderr = "";

      const onStdout = (chunk: Buffer) => {
        stdout += chunk.toString();
      };

      const onStderr = (chunk: Buffer) => {
        stderr += chunk.toString();
      };

      const cleanup = (): void => {
        child.stdout.off("data", onStdout);
        child.stderr.off("data", onStderr);
        child.off("error", onError);
        child.off("close", onClose);
      };

      const resolve = (effect: Effect.Effect<ProcessResult, CliError>): void => {
        if (resolved) {
          return;
        }

        resolved = true;
        cleanup();
        resume(effect);
      };

      const onError = (error: Error) => {
        resolve(Effect.fail(new CliError(`Failed to run ${command}: ${error.message}`)));
      };

      const onClose = (exitCode: number | null) => {
        const normalizedExit = exitCode ?? 1;
        if (normalizedExit !== 0 && options?.allowNonZeroExit !== true) {
          resolve(
            Effect.fail(
              new CliError(
                [`Command failed: ${command} ${args.join(" ")}`, stderr.trim(), stdout.trim()].filter(Boolean).join("\n")
              )
            )
          );
          return;
        }

        resolve(
          Effect.succeed({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: normalizedExit
          })
        );
      };

      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.on("error", onError);
      child.on("close", onClose);

      return Effect.sync(() => {
        if (resolved) {
          return;
        }

        resolved = true;
        cleanup();
        child.kill("SIGTERM");
      });
    })
};

export const ProcessServiceLive = Layer.succeed(ProcessService, make);
