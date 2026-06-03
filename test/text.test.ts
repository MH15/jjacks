import { describe, expect, it } from "vitest";

import type { SyncPlan } from "../src/domain.js";
import { renderSyncPreview } from "../src/text.js";

const plan: SyncPlan = {
  stack: [
    {
      entry: {
        name: "feat/base",
        changeId: "aaa111",
        commitId: "111aaa",
        parentBookmarkName: undefined,
        branchName: "jj/feat/base"
      },
      intendedBaseBranch: "main",
      pullRequest: null,
      actions: ['create PR titled "feat/base" with base main']
    }
  ]
};

describe("renderSyncPreview", () => {
  it("includes both the plan and stack comment preview", () => {
    const output = renderSyncPreview(plan, "<!-- jjacks:stack -->\n- pending");

    expect(output).toContain("jjacks sync plan");
    expect(output).toContain("stack comment preview");
    expect(output).toContain("<!-- jjacks:stack -->");
  });
});
