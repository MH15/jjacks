import type { StackEntry } from "./domain";
import { CliError } from "./errors";

export type DiffFormat = "full" | "summary" | "stat";

export const resolveDiffFormat = (options: {
  readonly summary: boolean;
  readonly stat: boolean;
}): DiffFormat => {
  if (options.summary && options.stat) {
    throw new CliError("Choose at most one diff format flag: --summary or --stat.");
  }

  if (options.summary) {
    return "summary";
  }

  if (options.stat) {
    return "stat";
  }

  return "full";
};

export const resolveDiffBase = (options: {
  readonly stack: ReadonlyArray<StackEntry>;
  readonly defaultBranch: string;
  readonly against?: string;
}): string => {
  if (options.against !== undefined) {
    return options.against;
  }

  const parent = options.stack[options.stack.length - 2]?.branchName;
  return parent ?? options.defaultBranch;
};

export const buildDiffArgs = (options: {
  readonly stack: ReadonlyArray<StackEntry>;
  readonly defaultBranch: string;
  readonly against?: string;
  readonly format: DiffFormat;
}): ReadonlyArray<string> => {
  if (options.stack.length === 0) {
    throw new CliError("No bookmarks found in the current stack.");
  }

  const base = resolveDiffBase(options);
  const args = ["diff", "--from", base, "--to", "@"] as Array<string>;

  if (options.format === "summary") {
    args.push("--summary");
  } else if (options.format === "stat") {
    args.push("--stat");
  }

  return args;
};
