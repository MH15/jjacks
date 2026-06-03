import { describe, expect, it } from "vitest";

import { CliError } from "../src/errors";
import { resolveSyncMode } from "../src/sync-mode";

describe("resolveSyncMode", () => {
  it("defaults to dry-run when execute is false", () => {
    expect(resolveSyncMode({ execute: false, dryRun: false })).toBe("dry-run");
  });

  it("allows an explicit dry-run flag", () => {
    expect(resolveSyncMode({ execute: false, dryRun: true })).toBe("dry-run");
  });

  it("switches to execute mode when requested", () => {
    expect(resolveSyncMode({ execute: true, dryRun: false })).toBe("execute");
  });

  it("rejects conflicting mode flags", () => {
    expect(() => resolveSyncMode({ execute: true, dryRun: true })).toThrow(CliError);
  });
});
