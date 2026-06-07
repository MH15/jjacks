# Open Questions

This document captures the biggest product and engineering questions before `jjacks` can be trusted in larger professional stacked-review workflows.

The goal is not to solve every possible `jj` topology. The near-term goal is a 90/10 implementation: reliable enough for real teams that use one bookmark per PR, while keeping the tool small and legible.

## 1. How Do We Recover From Partial Sync Failures?

`jjacks sync --execute` currently applies several independent side effects:

- fill blank jj descriptions
- push bookmarks
- create or edit PRs
- write stack comments or PR-body breadcrumbs

If any later step fails, the local repo and GitHub may be partially reconciled. That is manageable for personal use, but scary in a large workflow where a command may create several PRs or retarget active review branches.

### 90/10 Implementation

Add a local operation journal under `.jjacks/operations/`.

Each `sync --execute` writes a JSON file before doing side effects:

```json
{
  "id": "2026-06-07T22-10-00Z-sync",
  "command": "sync",
  "startedAt": "2026-06-07T22:10:00Z",
  "status": "running",
  "steps": [
    { "kind": "describe", "bookmark": "feat/base", "status": "pending" },
    { "kind": "push", "bookmark": "feat/base", "status": "pending" },
    { "kind": "create-pr", "bookmark": "feat/base", "base": "main", "status": "pending" }
  ]
}
```

Update each step after success or failure.

Add:

- `jjacks sync --resume`
- `jjacks sync --abort-journal`
- `jjacks doctor` warning when a journal is left in `running` or `failed`

The resume behavior can be idempotent:

- descriptions can be checked again
- pushes can be checked again
- existing PRs can be rediscovered by head branch
- comments can be upserted by marker

### Not Yet

Do not attempt true rollback. GitHub side effects are hard to safely undo. Resume plus clear status is the practical win.

## 2. Should `refresh` Update GitHub Too?

The tutorial says `refresh` should restack surviving work and update PR bases. The current command handles the local restack/continuation part, but GitHub PR bases are only fixed by a later `sync`.

That gap is surprising because post-merge refresh is exactly when review state needs to be repaired.

### 90/10 Implementation

Make the default flow explicit:

- `jjacks refresh` performs local-only refresh and prints `next: jjacks sync`
- `jjacks refresh --sync` performs refresh, then runs the same sync planner
- `jjacks refresh --sync --execute` applies the sync without a second prompt

The preview should say clearly:

```text
jjacks refresh
- fetched origin
- moved main to main@origin
- restacked feat/ui onto main
- continuing feat/ui

jjacks sync plan
feat/ui (PR #13)
- retarget PR #13 base from feat/base to main
- push bookmark
```

### Not Yet

Do not make refresh always mutate GitHub. Keeping `refresh` local by default makes it safe to run while resolving conflicts or inspecting the stack.

## 3. How Explicit Should Stack Identity Be?

Today the active stack is inferred from `jj log`, bookmarks, ancestors, and the current working copy. That is elegant, but large repos can contain multiple unrelated stacks, old bookmarks, merged-away bases, and odd topologies.

The biggest risk is not that inference fails loudly. The bigger risk is that it confidently syncs the wrong set of bookmarks.

### 90/10 Implementation

Add explicit stack metadata in jj config or a repo-local state file.

Recommended first version:

```toml
[jjacks.stacks.default]
trunk = "main"
roots = ["feat/base"]
```

Then support:

- `jjacks stack init <root-bookmark>`
- `jjacks stack list`
- `jjacks stack use <name>`
- `jjacks status --all`

When stack metadata is missing, keep the current inference behavior. When metadata exists, status/sync should constrain themselves to the configured root set.

### Not Yet

Do not build a full multi-stack UI. A named stack root plus current inferred lane gives most of the safety without turning `jjacks` into a project-management system.

## 4. How Robust Should PR Discovery Be?

PR lookup currently shells out to `gh pr list --state open --limit 200` and filters by `headRefName`. This is enough for a small repo, but it can miss or confuse PRs in larger setups.

Important cases:

- more than 200 open PRs
- forked PRs
- duplicate branch names across owners
- closed or merged PRs that still matter during refresh
- renamed branches
- protected branch policies

### 90/10 Implementation

Introduce a `PullRequestIndex` service that queries GitHub by exact head refs and paginates.

For each branch, query:

```bash
gh pr list --head OWNER:branch --state all --json number,url,title,headRefName,headRepositoryOwner,baseRefName,state,isDraft,body
```

Track enough fields to distinguish:

- open
- merged
- closed-unmerged
- missing

Then update sync planning rules:

- open PR exists: edit it
- merged PR exists: treat bookmark as landed or obsolete, depending on local ancestry
- closed-unmerged PR exists: warn before recreating
- multiple matches: fail with an explicit disambiguation message

### Not Yet

Do not replace `gh` with a custom GitHub API client yet. `gh` is still the right dependency for auth and user ergonomics.

## 5. What End-To-End Tests Prove The Workflow?

The unit tests are useful and fast, but they mostly test injected services and pure planning. A stacking tool needs confidence that real `jj`, real `git`, and command sequencing behave the way the tests claim.

### 90/10 Implementation

Add an integration test harness that creates temporary repos under the test temp directory.

Each scenario should:

- initialize a Git repo
- initialize jj
- configure `advance-bookmarks.enabled = true`
- create commits and bookmarks through actual commands
- run `node dist/cli.js ...`
- assert `jj log`, bookmark state, and command output

Start with five scenarios:

- create first bookmark from empty trunk continuation
- create child bookmark from an existing bookmark
- sync dry-run for two-layer stack without calling GitHub
- refresh after simulated merged lower layer
- up/down through a multi-child stack

Mock GitHub at the process boundary with a fake `gh` executable earlier in `PATH`. That keeps tests deterministic while still exercising the real CLI and process service.

### Not Yet

Do not require network access in CI. No real GitHub calls should be needed for the first production-confidence jump.

## Proposed Build Order

1. Add integration harness with fake `gh`.
2. Add explicit `PullRequestIndex` and better PR state modeling.
3. Add `refresh --sync` and make the local-vs-GitHub boundary obvious.
4. Add sync operation journals and `sync --resume`.
5. Add optional named stack roots once the implicit model has sharper tests.

This order buys confidence before adding more behavior. The harness catches regressions, PR indexing makes sync safer, refresh closes the biggest workflow gap, journaling handles failures, and explicit stack roots reduce ambiguity once real-world usage needs it.
