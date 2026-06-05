import { describe, expect, it } from "vitest";

import { CliError } from "../src/errors";
import { parseSyncConfirmation, resolveSyncMode } from "../src/sync-mode";

describe("resolveSyncMode", () => {
  it("defaults to interactive confirm when no mode flags are set", () => {
    expect(resolveSyncMode({ execute: false, dryRun: false })).toBe("confirm");
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

describe("parseSyncConfirmation", () => {
  it("treats empty input as yes", () => {
    expect(parseSyncConfirmation("")).toBe(true);
  });

  it("accepts yes responses", () => {
    expect(parseSyncConfirmation("y")).toBe(true);
    expect(parseSyncConfirmation("yes")).toBe(true);
    expect(parseSyncConfirmation(" Y ")).toBe(true);
  });

  it("accepts no responses", () => {
    expect(parseSyncConfirmation("n")).toBe(false);
    expect(parseSyncConfirmation("no")).toBe(false);
    expect(parseSyncConfirmation(" No ")).toBe(false);
  });

  it("returns undefined for invalid responses", () => {
    expect(parseSyncConfirmation("maybe")).toBeUndefined();
  });
});
