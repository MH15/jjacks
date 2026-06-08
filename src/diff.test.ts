import { describe, expect, it } from "vitest";

import type { StackEntry } from "../src/domain";
import { CliError } from "../src/errors";
import { buildDiffArgs, resolveDiffBase, resolveDiffFormat } from "../src/diff";

const stack: ReadonlyArray<StackEntry> = [
  {
    name: "feat/base",
    changeId: "aaa111",
    commitId: "111aaa",
    description: "feat/base",
    parentBookmarkName: undefined,
    branchName: "feat/base",
    isCurrent: false,
  },
  {
    name: "feat/ui",
    changeId: "bbb222",
    commitId: "222bbb",
    description: "feat/ui",
    parentBookmarkName: "feat/base",
    branchName: "feat/ui",
    isCurrent: true,
  },
];

describe("resolveDiffFormat", () => {
  it("defaults to full output", () => {
    expect(resolveDiffFormat({ summary: false, stat: false })).toBe("full");
  });

  it("supports summary output", () => {
    expect(resolveDiffFormat({ summary: true, stat: false })).toBe("summary");
  });

  it("supports stat output", () => {
    expect(resolveDiffFormat({ summary: false, stat: true })).toBe("stat");
  });

  it("rejects conflicting output flags", () => {
    expect(() => resolveDiffFormat({ summary: true, stat: true })).toThrow(CliError);
  });
});

describe("resolveDiffBase", () => {
  it("defaults to the parent bookmark branch", () => {
    expect(resolveDiffBase({ stack, defaultBranch: "main" })).toBe("feat/base");
  });

  it("falls back to the default branch for a single-bookmark stack", () => {
    expect(resolveDiffBase({ stack: [stack[0]!], defaultBranch: "main" })).toBe("main");
  });

  it("uses an explicit override when provided", () => {
    expect(resolveDiffBase({ stack, defaultBranch: "main", against: "main" })).toBe("main");
  });
});

describe("buildDiffArgs", () => {
  it("builds a parent-vs-current diff by default", () => {
    expect(buildDiffArgs({ stack, defaultBranch: "main", format: "full" })).toEqual([
      "diff",
      "--from",
      "feat/base",
      "--to",
      "@",
    ]);
  });

  it("supports summary and explicit base overrides", () => {
    expect(
      buildDiffArgs({ stack, defaultBranch: "main", against: "main", format: "summary" }),
    ).toEqual(["diff", "--from", "main", "--to", "@", "--summary"]);
  });
});
