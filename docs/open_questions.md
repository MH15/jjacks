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

## 2. Should `sync` Own Local Refresh Too?

Decision: yes. `sync` should be the convergence command.

The previous split between `refresh` and `sync` separated local stack repair from GitHub repair, but the real user intent is simpler: make my current stack match trunk and GitHub.

### 90/10 Implementation

Make `jjacks sync` preview the whole convergence plan:

- fetch origin
- move the default bookmark to its remote
- rebase the active stack root onto the default bookmark
- continue from the current stack entry
- push syncable bookmarks
- create/update/retarget syncable PRs
- update stack breadcrumbs for syncable PRs

The preview should say clearly:

```text
jjacks sync plan
local
- fetch origin
- move main to main@origin
- rebase feat/ui onto main
- continue from feat/ui

github
feat/ui (PR #13)
- retarget PR #13 base from feat/base to main
- push bookmark
```

If any bookmark conflicts during restack, that bookmark and all descendants are blocked from GitHub mutation. Clean sibling subtrees may still sync.

### Not Yet

Do not add a second local-only command yet. If we need one later, prefer `jjacks sync --local-only` over reviving a separate `refresh` workflow.

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
- sync after simulated merged lower layer
- up/down through a multi-child stack

Mock GitHub at the process boundary with a fake `gh` executable earlier in `PATH`. That keeps tests deterministic while still exercising the real CLI and process service.

### Not Yet

Do not require network access in CI. No real GitHub calls should be needed for the first production-confidence jump.

## Proposed Build Order

1. Add integration harness with fake `gh`.
2. Add explicit `PullRequestIndex` and better PR state modeling.
3. Make sync own local refresh and make the local-vs-GitHub boundary obvious in the plan.
4. Add sync operation journals and `sync --resume`.
5. Add optional named stack roots once the implicit model has sharper tests.

This order buys confidence before adding more behavior. The harness catches regressions, PR indexing makes sync safer, sync-owned refresh closes the biggest workflow gap, journaling handles failures, and explicit stack roots reduce ambiguity once real-world usage needs it.
