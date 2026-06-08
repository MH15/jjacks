# Open Questions

This document captures the biggest product and engineering questions before `jjacks` can be trusted in larger professional stacked-review workflows.

The goal is not to solve every possible `jj` topology. The near-term goal is a 90/10 implementation: reliable enough for real teams that use one bookmark per PR, while keeping the tool small and legible.

## Current State

The core happy path is in good shape for internal dogfooding:

- `sync` is the convergence command: it previews local refresh work, bookmark pushes, PR creation or updates, and stack breadcrumb changes.
- PR discovery now queries GitHub per branch with bounded concurrency using `gh pr list --head <branch> --state all`.
- Duplicate open PRs for one branch fail loudly before mutation, including PR numbers and head owners.
- Conflict analysis blocks conflicted entries and their descendants while allowing clean sibling subtrees to remain syncable.
- Unit tests cover planning, PR lookup, navigation, text rendering, and sync behavior.
- Integration tests run real `git`, real `jj`, the built CLI, and a fake `gh` executable in CI.
- oxlint and oxfmt are enabled through `npm run check`, and CI runs that check.

Known local verification at the time this was updated:

- `npm run check`
- `npm test`
- `npm run test:integration`
- `npm run build`

## Launch Blockers

These are the blockers before calling `jjacks` production ready for public or broad team use.

### 1. Npm Packaging Is Not Ready

`package.json` still marks the package as private, and `npm pack --dry-run` currently includes the vendored `repos/effect` tree, tests, source files, CI files, notes, and development-only docs.

That makes the package too large and leaks reference material that should never be published as part of the CLI.

#### 90/10 Implementation

Add a package allowlist:

```json
{
  "files": ["dist", "README.md", "LICENSE"]
}
```

Then decide whether the first launch target is:

- npm package release
- GitHub release artifact
- repo-local/internal install only

For npm, also add or verify:

- `"private": false` or remove `"private"`
- repository metadata
- issue tracker metadata
- publish access and package name ownership
- a release script that builds before packing

Run:

```bash
npm --cache /tmp/jjacks-npm-cache pack --dry-run
```

The tarball should contain only the runtime CLI and user-facing package metadata.

### 2. Integration Coverage Is Too Thin

The integration harness exists and is valuable, but it still covers only a small slice of real workflows.

Current integration coverage proves:

- a real jj repo can be inspected
- fake GitHub discovery works through a fake `gh` executable
- duplicate open PR ambiguity fails loudly
- sync dry-run can render a plan for a real two-bookmark stack without calling real GitHub

That is enough to keep development honest, but not enough to trust broad production use.

#### 90/10 Implementation

Extend the integration test harness with execute-path scenarios:

- create first bookmark from an empty trunk continuation
- create child bookmark from an existing bookmark
- execute sync creates missing PRs through fake `gh`
- execute sync updates existing PR title/base metadata
- execute sync updates stack comments or PR body breadcrumbs
- sync after simulated merged lower layer retargets surviving children
- conflicted entries block their descendants from GitHub mutation
- clean sibling subtrees still sync when another subtree is blocked
- `up` and `down` move through a multi-child stack predictably

Keep GitHub mocked at the process boundary with a fake `gh` executable earlier in `PATH`. No CI test should require real network access or real GitHub auth.

### 3. Launch Docs Need A Pass

The docs now describe the intended shape more accurately, but the user-facing launch path is still thin.

Before launch, the README and tutorial should answer:

- how to install `jjacks`
- which Node, `jj`, `git`, and `gh` versions are expected
- how to authenticate `gh`
- how to configure `advance-bookmarks.enabled`
- how to choose stack comment location
- how dry-run, interactive confirmation, and `--execute` differ
- what to do after a failed sync
- what workflows are still unsupported

The docs should clearly distinguish:

- production-supported behavior
- beta/dogfood behavior
- known non-goals

## Remaining Product Questions

These are important, but they should not block a constrained beta if the launch blockers above are handled or explicitly caveated.

### Should `sync --execute` Have An Operation Journal?

Decision for now: no, not for launch.

`jjacks sync --execute` applies several independent side effects:

- fill blank jj descriptions
- fetch and refresh local stack state
- push bookmarks
- create or edit PRs
- write stack comments or PR-body breadcrumbs

The current product stance is that these operations are rediscoverable enough for the near-term workflow. If a later step fails, users should run `jjacks status`, fix the underlying problem, and rerun `jjacks sync`.

Revisit operation journals only if real usage shows repeated confusing partial-failure states. The future version would use a local `.jjacks/operations/` journal plus `sync --resume`, but that is hardening work rather than a launch blocker.

### How Explicit Should Stack Identity Be?

Today the active stack is inferred from `jj log`, bookmarks, ancestors, and the current working copy. That is elegant, but large repos can contain multiple unrelated stacks, old bookmarks, merged-away bases, and odd topologies.

The biggest risk is not that inference fails loudly. The bigger risk is that it confidently syncs the wrong set of bookmarks.

#### 90/10 Implementation

Add optional explicit stack metadata in jj config or a repo-local state file.

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

When stack metadata is missing, keep the current inference behavior. When metadata exists, status and sync should constrain themselves to the configured root set.

#### Not Yet

Do not build a full multi-stack UI. A named stack root plus current inferred lane gives most of the safety without turning `jjacks` into a project-management system.

### Should GitHub Access Stay Shell-Based?

Decision for now: yes.

`gh` is still the right dependency for auth and user ergonomics. The current shell-based service is easy to fake in tests and avoids owning GitHub token management.

Revisit this only if:

- `gh pr list --head` behavior becomes a limiting factor
- rate limits become hard to manage
- the command output cannot represent a needed PR state
- performance becomes a real problem for large stacks

### How Much Local Refresh Should `sync` Own?

Decision for now: `sync` should remain the convergence command.

The split between local stack repair and GitHub repair is an implementation detail. The user intent is simpler: make my current stack match trunk and GitHub.

The current implementation already moves in that direction. The remaining work is to make failure recovery and test coverage strong enough that the convergence command feels safe.

## Proposed Build Order

1. Fix package contents and decide the release channel.
2. Expand integration tests around `sync --execute` and navigation.
3. Update README and tutorial for launch-quality install, setup, and recovery docs.
4. Add optional named stack roots once real-world usage shows that inference needs more guardrails.

This order removes the immediate launch hazards first, then improves confidence, then adds broader workflow safety.
