import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";

import { JjService, JjServiceLive } from "../src/services/JjService";
import { ProcessService, type ProcessResult } from "../src/services/ProcessService";

const trackedBookmarksRevsetForTest = "(::(bookmarks() & ~::trunk())) & ~::trunk()";

const makeProcessLayer = (
  responses: (command: string, args: ReadonlyArray<string>) => ProcessResult
) =>
  Layer.succeed(ProcessService, {
    run: (command: string, args: ReadonlyArray<string>) => Effect.succeed(responses(command, args))
  });

describe("JjService.editWorkingCopyOnStack", () => {
  it("rebases the effective root and edits the current bookmark for amend-style work", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "rebase") {
        return { stdout: "", stderr: "", exitCode: 0 };
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

      if (args[0] === "new") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        return yield* jjService.editWorkingCopyOnStack({
          rootBookmarkName: "feat/base",
          currentBookmarkName: "feat/ui",
          defaultBranch: "main"
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(output).toBe("current summary");
    expect(calls.some((args) => args.join(" ") === "rebase -s feat/base -d main")).toBe(true);
    expect(calls.some((args) => args.join(" ") === "edit feat/ui")).toBe(true);
    expect(calls.some((args) => args[0] === "new")).toBe(false);
  });
});

describe("JjService.editWorkingCopyOnBookmark", () => {
  it("edits the requested bookmark instead of creating a continuation", async () => {
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

      if (args[0] === "new") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        return yield* jjService.editWorkingCopyOnBookmark({
          bookmarkName: "main"
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(output).toBe("current summary");
    expect(calls.some((args) => args.join(" ") === "edit main")).toBe(true);
    expect(calls.some((args) => args[0] === "new")).toBe(false);
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
  it("reuses the current unbookmarked working copy even when its description is blank", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[1] === "-r" && args[2] === "@") {
        return {
          stdout: "tlmkkspu\t\t\tjjacks",
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
          stdout: "bbb222\tfeat/base\tfeat/base\tjjacks",
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

describe("JjService.logBookmarks", () => {
  const descendantsStdout = [
    "feat/base\taaa111\t111aaa\tfeat/base\tfalse\tfalse\t",
    "feat/right\tbbb222\t222bbb\tfeat/right\tfalse\tfalse\taaa111",
    "feat/left\tccc333\t333ccc\tfeat/left\tfalse\tfalse\taaa111"
  ].join("\n");

  it("logs only the current tree by default", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[1] === "-r" && args[2] === trackedBookmarksRevsetForTest) {
        return { stdout: descendantsStdout, stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[1] === "-r" && args[2] === `::@ & ${trackedBookmarksRevsetForTest}`) {
        return {
          stdout: "feat/right\tbbb222\t222bbb\tfeat/right\tfalse\tfalse\taaa111",
          stderr: "",
          exitCode: 0
        };
      }

      if (args[0] === "log" && args[1] === "-r" && args[2] === 'trunk() | descendants(change_id("aaa111"))') {
        return { stdout: "current tree log", stderr: "", exitCode: 0 };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        return yield* jjService.logBookmarks({
          mode: "tree",
          noGraph: false
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(output).toBe("current tree log");
    expect(calls.some((args) => args.join(" ") === 'log -r trunk() | descendants(change_id("aaa111"))')).toBe(true);
  });

  it("limits bookmarks-only logging to the current tree bookmarks", async () => {
    const calls: Array<ReadonlyArray<string>> = [];

    const processLayer = makeProcessLayer((_command, args) => {
      calls.push(args);

      if (args[0] === "config") {
        return { stdout: "true", stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[1] === "-r" && args[2] === trackedBookmarksRevsetForTest) {
        return { stdout: descendantsStdout, stderr: "", exitCode: 0 };
      }

      if (args[0] === "log" && args[1] === "-r" && args[2] === `::@ & ${trackedBookmarksRevsetForTest}`) {
        return {
          stdout: "feat/right\tbbb222\t222bbb\tfeat/right\tfalse\tfalse\taaa111",
          stderr: "",
          exitCode: 0
        };
      }

      if (
        args[0] === "log" &&
        args[1] === "-r" &&
        args[2] === 'bookmarks() & descendants(change_id("aaa111")) & ~trunk()'
      ) {
        return { stdout: "current tree bookmarks", stderr: "", exitCode: 0 };
      }

      throw new Error(`Unexpected command: jj ${args.join(" ")}`);
    });

    const output = await Effect.runPromise(
      Effect.gen(function* () {
        const jjService = yield* JjService;
        return yield* jjService.logBookmarks({
          mode: "bookmarks-only",
          noGraph: true
        });
      }).pipe(Effect.provide(Layer.mergeAll(processLayer, JjServiceLive)))
    );

    expect(output).toBe("current tree bookmarks");
    expect(
      calls.some((args) =>
        args.join(" ") === 'log -r bookmarks() & descendants(change_id("aaa111")) & ~trunk() --no-graph'
      )
    ).toBe(true);
  });
});
