import { describe, expect, it } from "vitest";

import { renderRefreshSummary } from "../src/refresh";

describe("renderRefreshSummary", () => {
  it("renders the refresh steps and resulting jj state", () => {
    const output = renderRefreshSummary(
      "main",
      "abcd1234 user@example.com 2026-06-04\nStart next change from main\nmain efgh5678 Merge pull request"
    );

    expect(output).toContain("jjacks refresh");
    expect(output).toContain("fetched origin");
    expect(output).toContain("moved main to main@origin");
    expect(output).toContain("rebased @ onto main");
    expect(output).toContain("current jj state");
  });
});
