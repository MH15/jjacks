import { describe, expect, it } from "vitest";

import type { StackEntry } from "../src/domain";
import { resolveBookmarkMovePlan } from "../src/navigation";

const makeEntry = (overrides: Partial<StackEntry> & Pick<StackEntry, "name">): StackEntry => ({
  name: overrides.name,
  changeId: overrides.changeId ?? `${overrides.name}-change`,
  commitId: overrides.commitId ?? `${overrides.name}-commit`,
  description: overrides.description ?? overrides.name,
  parentBookmarkName: overrides.parentBookmarkName,
  branchName: overrides.branchName ?? overrides.name,
  isCurrent: overrides.isCurrent ?? false,
  ...(overrides.isEmpty === undefined ? {} : { isEmpty: overrides.isEmpty })
});

describe("resolveBookmarkMovePlan", () => {
  it("moves down to the parent bookmark from the current entry", () => {
    const entries = [
      makeEntry({ name: "feat/base" }),
      makeEntry({ name: "feat/ui", parentBookmarkName: "feat/base", isCurrent: true }),
      makeEntry({ name: "feat/api", parentBookmarkName: "feat/ui" })
    ];

    expect(resolveBookmarkMovePlan("down", entries)).toEqual({
      kind: "move-to-bookmark",
      bookmarkName: "feat/base"
    });
  });

  it("moves up directly when there is a single child bookmark", () => {
    const entries = [
      makeEntry({ name: "feat/base", isCurrent: true }),
      makeEntry({ name: "feat/ui", parentBookmarkName: "feat/base" })
    ];

    expect(resolveBookmarkMovePlan("up", entries)).toEqual({
      kind: "move-to-bookmark",
      bookmarkName: "feat/ui"
    });
  });

  it("prompts for a child bookmark when the current entry has multiple children", () => {
    const entries = [
      makeEntry({ name: "feat/base", isCurrent: true }),
      makeEntry({ name: "feat/api", parentBookmarkName: "feat/base" }),
      makeEntry({ name: "feat/ui", parentBookmarkName: "feat/base" })
    ];

    expect(resolveBookmarkMovePlan("up", entries)).toEqual({
      kind: "choose-child-bookmark",
      parentBookmarkName: "feat/base",
      childBookmarkNames: ["feat/api", "feat/ui"]
    });
  });

  it("reports when there is no active current bookmark entry", () => {
    const entries = [
      makeEntry({ name: "feat/base" }),
      makeEntry({ name: "feat/ui", parentBookmarkName: "feat/base" })
    ];

    expect(resolveBookmarkMovePlan("down", entries)).toEqual({
      kind: "no-current-bookmark"
    });

    expect(resolveBookmarkMovePlan("up", [])).toEqual({
      kind: "no-current-bookmark"
    });
  });

  it("moves up directly to a surviving root bookmark when there is only one root choice", () => {
    const entries = [
      makeEntry({ name: "feat/ui", parentBookmarkName: "feat/base" })
    ];

    expect(resolveBookmarkMovePlan("up", entries)).toEqual({
      kind: "move-to-bookmark",
      bookmarkName: "feat/ui"
    });
  });

  it("prompts for a root bookmark when there is no current bookmark but multiple root choices remain", () => {
    const entries = [
      makeEntry({ name: "feat/api", parentBookmarkName: "feat/base" }),
      makeEntry({ name: "feat/ui", parentBookmarkName: "feat/base" })
    ];

    expect(resolveBookmarkMovePlan("up", entries)).toEqual({
      kind: "choose-root-bookmark",
      rootBookmarkNames: ["feat/api", "feat/ui"]
    });
  });

  it("reports when there is no target bookmark in the requested direction", () => {
    const entries = [
      makeEntry({ name: "feat/base", isCurrent: true }),
      makeEntry({ name: "feat/ui", parentBookmarkName: "feat/base" })
    ];

    expect(resolveBookmarkMovePlan("down", entries)).toEqual({
      kind: "no-target-bookmark",
      direction: "down",
      currentBookmarkName: "feat/base"
    });

    expect(resolveBookmarkMovePlan("up", [
      makeEntry({ name: "feat/ui", parentBookmarkName: "feat/base", isCurrent: true })
    ])).toEqual({
      kind: "no-target-bookmark",
      direction: "up",
      currentBookmarkName: "feat/ui"
    });
  });
});
