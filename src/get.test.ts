import { describe, expect, it } from "vitest";

import { CliError } from "../src/errors";
import { buildGetPlan, ensureSupportedGetBranchName } from "../src/get";

describe("buildGetPlan", () => {
  it("plans to create a missing local bookmark from origin", () => {
    const plan = buildGetPlan({
      branchName: "feat/coworker",
      defaultBranch: "main",
      remote: {
        changeId: "remote-change",
        commitId: "abc123",
        parentCommitIds: ["parent"],
        diffHash: "diff",
      },
    });

    expect(plan.needsMutableImport).toBe(true);
    expect(plan.willOverwriteLocal).toBe(false);
    expect(plan.actions).toEqual([
      "fetch origin",
      "create mutable local bookmark feat/coworker from feat/coworker@origin",
      "edit feat/coworker",
    ]);
  });

  it("imports a mutable copy when the local bookmark points at the remote commit", () => {
    const plan = buildGetPlan({
      branchName: "feat/coworker",
      defaultBranch: "main",
      local: {
        changeId: "local-change",
        commitId: "abc123",
        parentCommitIds: ["parent"],
        diffHash: "diff",
      },
      remote: {
        changeId: "remote-change",
        commitId: "abc123",
        parentCommitIds: ["parent"],
        diffHash: "diff",
      },
    });

    expect(plan.needsMutableImport).toBe(true);
    expect(plan.willOverwriteLocal).toBe(false);
    expect(plan.actions).toContain(
      "replace immutable local bookmark feat/coworker with a mutable copy of feat/coworker@origin",
    );
  });

  it("plans an overwrite when local points at a different commit", () => {
    const plan = buildGetPlan({
      branchName: "feat/coworker",
      defaultBranch: "main",
      local: {
        changeId: "local-change",
        commitId: "local",
        parentCommitIds: ["parent"],
        diffHash: "diff",
      },
      remote: {
        changeId: "remote-change",
        commitId: "remote",
        parentCommitIds: ["parent"],
        diffHash: "other-diff",
      },
    });

    expect(plan.needsMutableImport).toBe(true);
    expect(plan.willOverwriteLocal).toBe(true);
    expect(plan.actions).toContain(
      "overwrite local bookmark feat/coworker with a mutable copy of feat/coworker@origin",
    );
  });

  it("keeps a mutable local duplicate when it has the same parent and diff as remote", () => {
    const plan = buildGetPlan({
      branchName: "feat/coworker",
      defaultBranch: "main",
      local: {
        changeId: "local-change",
        commitId: "local-duplicate",
        parentCommitIds: ["parent"],
        diffHash: "diff",
      },
      remote: {
        changeId: "remote-change",
        commitId: "remote",
        parentCommitIds: ["parent"],
        diffHash: "diff",
      },
    });

    expect(plan.needsMutableImport).toBe(false);
    expect(plan.willOverwriteLocal).toBe(false);
    expect(plan.actions).toContain(
      "keep local bookmark feat/coworker; already has a mutable copy of feat/coworker@origin",
    );
  });

  it("plans to continue from trunk when getting the default branch", () => {
    const plan = buildGetPlan({
      branchName: "main",
      defaultBranch: "main",
      local: {
        changeId: "local-change",
        commitId: "local",
        parentCommitIds: [],
        diffHash: "local-diff",
      },
      remote: {
        changeId: "remote-change",
        commitId: "remote",
        parentCommitIds: [],
        diffHash: "remote-diff",
      },
    });

    expect(plan.checkoutMode).toBe("trunk-continuation");
    expect(plan.needsMutableImport).toBe(false);
    expect(plan.willOverwriteLocal).toBe(true);
    expect(plan.actions).toEqual([
      "fetch origin",
      "overwrite local bookmark main with main@origin",
      "continue from main",
    ]);
  });

  it("does not warn when the default branch already matches origin", () => {
    const plan = buildGetPlan({
      branchName: "main",
      defaultBranch: "main",
      local: {
        changeId: "local-change",
        commitId: "remote",
        parentCommitIds: [],
        diffHash: "diff",
      },
      remote: {
        changeId: "remote-change",
        commitId: "remote",
        parentCommitIds: [],
        diffHash: "diff",
      },
    });

    expect(plan.checkoutMode).toBe("trunk-continuation");
    expect(plan.willOverwriteLocal).toBe(false);
    expect(plan.actions).toContain("keep local bookmark main; already matches main@origin");
  });
});

describe("ensureSupportedGetBranchName", () => {
  it("accepts branch names jjacks can round-trip", () => {
    expect(() => ensureSupportedGetBranchName("feat/coworker_branch-1")).not.toThrow();
  });

  it("rejects branch names that would be remapped during sync", () => {
    expect(() => ensureSupportedGetBranchName("feat/coworker.branch")).toThrow(CliError);
  });
});
