import { CliError } from "./errors";

export type SyncMode = "confirm" | "dry-run" | "execute";

export const resolveSyncMode = (options: { execute: boolean; dryRun: boolean }): SyncMode => {
  if (options.execute && options.dryRun) {
    throw new CliError("Choose at most one sync mode flag: --execute or --dry-run.");
  }

  if (!options.execute && !options.dryRun) {
    return "confirm";
  }

  if (options.execute) {
    return "execute";
  }

  return "dry-run";
};

export const parseSyncConfirmation = (input: string): boolean | undefined => {
  const normalized = input.trim().toLowerCase();

  if (normalized === "" || normalized === "y" || normalized === "yes") {
    return true;
  }

  if (normalized === "n" || normalized === "no") {
    return false;
  }

  return undefined;
};
