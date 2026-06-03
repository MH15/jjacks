import { spawn } from "node:child_process";

import { Context, Effect, Layer } from "effect";

import { CliError } from "../errors.js";

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

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        resume(Effect.fail(new CliError(`Failed to run ${command}: ${error.message}`)));
      });

      child.on("close", (exitCode) => {
        const normalizedExit = exitCode ?? 1;
        if (normalizedExit !== 0 && options?.allowNonZeroExit !== true) {
          resume(
            Effect.fail(
              new CliError(
                [`Command failed: ${command} ${args.join(" ")}`, stderr.trim(), stdout.trim()].filter(Boolean).join("\n")
              )
            )
          );
          return;
        }

        resume(
          Effect.succeed({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: normalizedExit
          })
        );
      });
    })
};

export const ProcessServiceLive = Layer.succeed(ProcessService, make);
