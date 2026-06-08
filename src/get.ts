import { CliError } from "./errors";

export type BookmarkSnapshot = {
  readonly changeId: string;
  readonly commitId: string;
  readonly parentCommitIds: ReadonlyArray<string>;
  readonly diffHash: string;
  readonly description?: string;
};

export type GetPlan = {
  readonly branchName: string;
  readonly remote: BookmarkSnapshot;
  readonly local?: BookmarkSnapshot;
  readonly actions: ReadonlyArray<string>;
  readonly needsMutableImport: boolean;
  readonly willOverwriteLocal: boolean;
};

export const deriveBranchName = (bookmarkName: string): string =>
  bookmarkName.replace(/[^A-Za-z0-9/_-]+/g, "-");

export const ensureSupportedGetBranchName = (branchName: string): void => {
  if (branchName.trim().length === 0) {
    throw new CliError("Branch name is required.");
  }

  const derivedBranchName = deriveBranchName(branchName);
  if (derivedBranchName !== branchName) {
    throw new CliError(
      [
        `Branch ${branchName} cannot be imported by jjacks yet.`,
        `jjacks would map it to ${derivedBranchName} when syncing, so use a branch name containing only letters, numbers, "/", "_", or "-".`,
      ].join("\n"),
    );
  }
};

export const buildGetPlan = ({
  branchName,
  local,
  remote,
}: {
  readonly branchName: string;
  readonly local?: BookmarkSnapshot;
  readonly remote: BookmarkSnapshot;
}): GetPlan => {
  const localMatchesRemoteCommit = local?.commitId === remote.commitId;
  const localMatchesMutableCopy =
    local !== undefined &&
    !localMatchesRemoteCommit &&
    local.diffHash === remote.diffHash &&
    local.parentCommitIds.join(",") === remote.parentCommitIds.join(",");
  const needsMutableImport =
    local === undefined || localMatchesRemoteCommit || !localMatchesMutableCopy;
  const willOverwriteLocal =
    local !== undefined && !localMatchesRemoteCommit && !localMatchesMutableCopy;

  return {
    branchName,
    remote,
    ...(local === undefined ? {} : { local }),
    needsMutableImport,
    willOverwriteLocal,
    actions: [
      "fetch origin",
      local === undefined
        ? `create mutable local bookmark ${branchName} from ${branchName}@origin`
        : localMatchesMutableCopy
          ? `keep local bookmark ${branchName}; already has a mutable copy of ${branchName}@origin`
          : localMatchesRemoteCommit
            ? `replace immutable local bookmark ${branchName} with a mutable copy of ${branchName}@origin`
            : `overwrite local bookmark ${branchName} with a mutable copy of ${branchName}@origin`,
      `edit ${branchName}`,
    ],
  };
};
