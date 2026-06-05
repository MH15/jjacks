export const renderRefreshSummary = (bookmarkName: string, workingCopyLog: string): string =>
  [
    "jjacks refresh",
    `- fetched origin`,
    `- moved ${bookmarkName} to ${bookmarkName}@origin`,
    `- created a fresh working-copy change on ${bookmarkName}`,
    `- rebased @ onto ${bookmarkName}`,
    "",
    "current jj state",
    workingCopyLog
  ].join("\n");
