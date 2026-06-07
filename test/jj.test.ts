import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import { JjService, JjServiceLive } from "../src/services/JjService";
import { ProcessService, type ProcessResult } from "../src/services/ProcessService";

const makeProcessLayer = (
  responses: (command: string, args: ReadonlyArray<string>) => ProcessResult
) =>
  Layer.succeed(ProcessService, {
    run: (command: string, args: ReadonlyArray<string>) => Effect.succeed(responses(command, args))
  });

describe("JjService.continueWorkingCopyOnStack", () => {
  it("reuses the existing continuation change when already continuing from the stack tip", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "rebase") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[2] === "@ | @-") {
        return {
          stdout: "\tContinue feat/ui\nfeat/ui\tfeat/ui",
          stderr: "",
          exitCode: 0
        };
      }

      if (args[0] === "log" && args[2] === "@ | @- | @--") {
        return {
          stdout: "current summary",
          stderr: "",
          exitCode: 0
        };
      }

      if (args[0] === "new") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        return yield* jjService.continueWorkingCopyOnStack({
          rootBookmarkName: "feat/base",
          tipBookmarkName: "feat/ui",
          defaultBranch: "main",
          message: "Continue feat/ui"
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(output).toBe("current summary");
    expect(calls.some((args) => args[0] === "new")).toBe(false);
  });

  it("creates a new continuation change when currently positioned on the tip bookmark itself", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "rebase") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[2] === "@ | @-") {
        return {
          stdout: "feat/ui\tfeat/ui\nfeat/base\tfeat/base",
          stderr: "",
          exitCode: 0
        };
      }

      if (args[0] === "new") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[2] === "@ | @- | @--") {
        return {
          stdout: "current summary",
          stderr: "",
          exitCode: 0
        };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        yield* jjService.continueWorkingCopyOnStack({
          rootBookmarkName: "feat/base",
          tipBookmarkName: "feat/ui",
          defaultBranch: "main",
          message: "Continue feat/ui"
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(calls.some((args) => args.join(" ") === "new feat/ui -m Continue feat/ui")).toBe(true);
  });
});

describe("JjService.moveToBookmark", () => {
  it("edits the working copy to the requested bookmark and returns the summary", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "edit") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[2] === "@ | @-") {
        return {
          stdout: "current summary",
          stderr: "",
          exitCode: 0
        };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        return yield* jjService.moveToBookmark("feat/ui");
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(output).toBe("current summary");
    expect(calls.some((args) => args.join(" ") === "edit feat/ui")).toBe(true);
  });
});

describe("JjService.createBookmark", () => {
  it("reuses the current unbookmarked working copy instead of creating another child change", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[1] === "-r" && args[2] === "@") {
        return {
          stdout: "\tStart next change from main",
          stderr: "",
          exitCode: 0
        };
      }

      if (args[0] === "bookmark" && args[1] === "create") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        yield* jjService.createBookmark({
          bookmarkName: "feat/ui",
          message: "feat/ui"
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(calls.some((args) => args[0] === "new")).toBe(false);
    expect(calls.some((args) => args.join(" ") === "bookmark create feat/ui")).toBe(true);
  });

  it("creates a new child change when the current working copy is already bookmarked", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[1] === "-r" && args[2] === "@") {
        return {
          stdout: "feat/base\tfeat/base",
          stderr: "",
          exitCode: 0
        };
      }

      if (args[0] === "new") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      if (args[0] === "bookmark" && args[1] === "create") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        yield* jjService.createBookmark({
          bookmarkName: "feat/ui",
          message: "feat/ui"
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(calls.some((args) => args.join(" ") === "new -m feat/ui")).toBe(true);
    expect(calls.some((args) => args.join(" ") === "bookmark create feat/ui")).toBe(true);
  });
});
