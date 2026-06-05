import { describe, expect, it } from "vitest";

import { CliError } from "../src/errors";

const resolveLogMode = (options: {
  readonly active: boolean;
  readonly bookmarksOnly: boolean;
}): "tree" | "active" | "bookmarks-only" => {
  if (options.active && options.bookmarksOnly) {
    throw new CliError("Choose at most one log scope flag: --active or --bookmarks-only.");
  }

  return options.active ? "active" : options.bookmarksOnly ? "bookmarks-only" : "tree";
};

describe("resolveLogMode", () => {
  it("defaults to the full tracked tree", () => {
    expect(resolveLogMode({ active: false, bookmarksOnly: false })).toBe("tree");
  });

  it("supports the active lane view", () => {
    expect(resolveLogMode({ active: true, bookmarksOnly: false })).toBe("active");
  });

  it("supports the bookmarks-only view", () => {
    expect(resolveLogMode({ active: false, bookmarksOnly: true })).toBe("bookmarks-only");
  });

  it("rejects conflicting scope flags", () => {
    expect(() => resolveLogMode({ active: true, bookmarksOnly: true })).toThrow(CliError);
  });
});
