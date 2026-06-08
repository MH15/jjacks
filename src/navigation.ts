import type { StackEntry } from "./domain";

export type BookmarkMoveDirection = "up" | "down";

export type BookmarkMovePlan =
  | {
      readonly kind: "no-current-bookmark";
    }
  | {
      readonly kind: "no-target-bookmark";
      readonly direction: BookmarkMoveDirection;
      readonly currentBookmarkName: string;
    }
  | {
      readonly kind: "move-to-bookmark";
      readonly bookmarkName: string;
    }
  | {
      readonly kind: "move-to-trunk-continuation";
    }
  | {
      readonly kind: "choose-child-bookmark";
      readonly parentBookmarkName: string;
      readonly childBookmarkNames: ReadonlyArray<string>;
    }
  | {
      readonly kind: "choose-root-bookmark";
      readonly rootBookmarkNames: ReadonlyArray<string>;
    };

export const resolveBookmarkMovePlan = (
  direction: BookmarkMoveDirection,
  entries: ReadonlyArray<StackEntry>
): BookmarkMovePlan => {
  const currentEntry = entries.find((entry) => entry.isCurrent);
  const entryNames = new Set(entries.map((entry) => entry.name));

  if (currentEntry === undefined && direction === "up") {
    const rootBookmarkNames = entries
      .filter((entry) => entry.parentBookmarkName === undefined || !entryNames.has(entry.parentBookmarkName))
      .map((entry) => entry.name);

    if (rootBookmarkNames.length === 0) {
      return { kind: "no-current-bookmark" };
    }

    if (rootBookmarkNames.length === 1) {
      return {
        kind: "move-to-bookmark",
        bookmarkName: rootBookmarkNames[0]!
      };
    }

    return {
      kind: "choose-root-bookmark",
      rootBookmarkNames
    };
  }

  if (currentEntry === undefined) {
    return { kind: "no-current-bookmark" };
  }

  if (direction === "down") {
    return currentEntry.parentBookmarkName === undefined
      ? {
          kind: "move-to-trunk-continuation"
        }
      : {
          kind: "move-to-bookmark",
          bookmarkName: currentEntry.parentBookmarkName
        };
  }

  const childBookmarkNames = entries
    .filter((entry) => entry.parentBookmarkName === currentEntry.name)
    .map((entry) => entry.name);

  if (childBookmarkNames.length === 0) {
    return {
      kind: "no-target-bookmark",
      direction,
      currentBookmarkName: currentEntry.name
    };
  }

  if (childBookmarkNames.length === 1) {
    return {
      kind: "move-to-bookmark",
      bookmarkName: childBookmarkNames[0]!
    };
  }

  return {
    kind: "choose-child-bookmark",
    parentBookmarkName: currentEntry.name,
    childBookmarkNames
  };
};
