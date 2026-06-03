import { CliError } from "./errors";

export type SyncMode = "dry-run" | "execute";

export const resolveSyncMode = (options: {
  readonly execute: boolean;
  readonly dryRun: boolean;
}): SyncMode => {
  if (options.execute && options.dryRun) {
    throw new CliError("Choose either --execute or --dry-run, not both.");
  }

  if (options.execute) {
    return "execute";
  }

  return "dry-run";
};
