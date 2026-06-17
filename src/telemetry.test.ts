import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import * as Schema from "effect/Schema";

import { CliError } from "../src/errors";
import {
  makeTelemetryService,
  recordProcessTiming,
  TelemetryCommandRecord,
} from "../src/services/TelemetryService";

describe("TelemetryService", () => {
  it("writes successful command records with step and process timings", async () => {
    const lines: Array<string> = [];
    const nowValues = [1_000, 1_010, 1_070, 1_100];
    const telemetry = makeTelemetryService({
      cwd: () => process.cwd(),
      now: () => nowValues.shift() ?? 1_100,
      randomId: () => "run-1",
      writeLine: (_repoRoot, line) => {
        lines.push(line);
      },
    });

    await Effect.runPromise(
      telemetry.withCommand(
        {
          command: "sync",
          args: ["sync", "--execute"],
        },
        telemetry.timeStep(
          {
            name: "refresh-local-stack",
            label: "Refresh local stack",
          },
          Effect.sync(() => {
            recordProcessTiming({
              command: "git",
              args: ["fetch", "origin"],
              startedAtMs: 1_020,
              finishedAtMs: 1_060,
              exitCode: 0,
              status: "success",
            });
          }),
        ),
      ),
    );

    expect(lines).toHaveLength(1);
    const record = Schema.decodeUnknownSync(TelemetryCommandRecord)(JSON.parse(lines[0]!));
    expect(record).toMatchObject({
      schemaVersion: 1,
      runId: "run-1",
      command: "sync",
      args: ["sync", "--execute"],
      durationMs: 100,
      status: "success",
    });
    expect(record.steps).toEqual([
      {
        name: "refresh-local-stack",
        label: "Refresh local stack",
        startedAt: "1970-01-01T00:00:01.010Z",
        durationMs: 60,
        status: "success",
      },
    ]);
    expect(record.processes).toEqual([
      {
        command: "git",
        args: ["fetch", "origin"],
        startedAt: "1970-01-01T00:00:01.020Z",
        durationMs: 40,
        exitCode: 0,
        status: "success",
      },
    ]);
  });

  it("writes failed command records before preserving the failure", async () => {
    const lines: Array<string> = [];
    const nowValues = [2_000, 2_030];
    const telemetry = makeTelemetryService({
      cwd: () => process.cwd(),
      now: () => nowValues.shift() ?? 2_030,
      randomId: () => "run-2",
      writeLine: (_repoRoot, line) => {
        lines.push(line);
      },
    });

    const exit = await Effect.runPromiseExit(
      telemetry.withCommand(
        {
          command: "status",
          args: ["status"],
        },
        Effect.fail(new CliError("not a repo")),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(lines).toHaveLength(1);
    const record = Schema.decodeUnknownSync(TelemetryCommandRecord)(JSON.parse(lines[0]!));
    expect(record.command).toBe("status");
    expect(record.status).toBe("failure");
    expect(record.durationMs).toBe(30);
    expect(record.error).toContain("not a repo");
  });

  it("subtracts paused command timing from successful command duration", async () => {
    const lines: Array<string> = [];
    const nowValues = [1_000, 1_010, 1_060, 1_100];
    const telemetry = makeTelemetryService({
      cwd: () => process.cwd(),
      now: () => nowValues.shift() ?? 1_100,
      randomId: () => "run-3",
      writeLine: (_repoRoot, line) => {
        lines.push(line);
      },
    });

    await Effect.runPromise(
      telemetry.withCommand(
        {
          command: "sync",
          args: ["sync"],
        },
        telemetry.pauseCommandTiming(Effect.void),
      ),
    );

    const record = Schema.decodeUnknownSync(TelemetryCommandRecord)(JSON.parse(lines[0]!));
    expect(record.startedAt).toBe("1970-01-01T00:00:01.000Z");
    expect(record.durationMs).toBe(50);
  });

  it("subtracts repeated and nested pauses without double-counting", async () => {
    const lines: Array<string> = [];
    const nowValues = [1_000, 1_010, 1_030, 1_040, 1_070, 1_100];
    const telemetry = makeTelemetryService({
      cwd: () => process.cwd(),
      now: () => nowValues.shift() ?? 1_100,
      randomId: () => "run-4",
      writeLine: (_repoRoot, line) => {
        lines.push(line);
      },
    });

    await Effect.runPromise(
      telemetry.withCommand(
        {
          command: "get",
          args: ["get", "main"],
        },
        Effect.gen(function* () {
          yield* telemetry.pauseCommandTiming(Effect.void);
          yield* telemetry.pauseCommandTiming(telemetry.pauseCommandTiming(Effect.void));
        }),
      ),
    );

    const record = Schema.decodeUnknownSync(TelemetryCommandRecord)(JSON.parse(lines[0]!));
    expect(record.durationMs).toBe(50);
  });

  it("subtracts paused command timing before preserving failures", async () => {
    const lines: Array<string> = [];
    const nowValues = [2_000, 2_010, 2_060, 2_090];
    const telemetry = makeTelemetryService({
      cwd: () => process.cwd(),
      now: () => nowValues.shift() ?? 2_090,
      randomId: () => "run-5",
      writeLine: (_repoRoot, line) => {
        lines.push(line);
      },
    });

    const exit = await Effect.runPromiseExit(
      telemetry.withCommand(
        {
          command: "merge",
          args: ["merge"],
        },
        telemetry.pauseCommandTiming(Effect.fail(new CliError("merge canceled"))),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const record = Schema.decodeUnknownSync(TelemetryCommandRecord)(JSON.parse(lines[0]!));
    expect(record.status).toBe("failure");
    expect(record.durationMs).toBe(40);
    expect(record.error).toContain("merge canceled");
  });
});
