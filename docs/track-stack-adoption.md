# Plan: Adopt External Stacks With `jjacks track`

## Goal

Support the flow where a user created a stack outside jjacks, such as in Graphite
or by manually stacking Git branches, and wants to bring that stack into jjacks as
editable jj bookmarks.

This should be an explicit stack-adoption command. It is more destructive than
`jjacks get` because it may rewrite multiple local branches to match the stack
shape the user provides.

## Proposed Command

```sh
jjacks track branch-a branch-b branch-c --onto main --dry-run
jjacks track branch-a branch-b branch-c --onto main
```

Branch arguments are ordered bottom-to-top:

```text
main
  branch-a
    branch-b
      branch-c
```

The first implementation should require `--onto`. That keeps the command
unambiguous and avoids guessing a stack base from GitHub PR metadata, Graphite
metadata, or local ancestry.

## User Experience

Dry run output should show every mutation before the command does anything:

```text
jjacks track plan

local
- fetch origin
- import branch-a from branch-a@origin as a mutable bookmark if needed
- import branch-b from branch-b@origin as a mutable bookmark if needed
- import branch-c from branch-c@origin as a mutable bookmark if needed
- track branch-a@origin
- track branch-b@origin
- track branch-c@origin
- rebase branch-a onto main
- rebase branch-b onto branch-a
- rebase branch-c onto branch-b
- edit branch-c
```

Non-dry-run should use a default-No confirmation:

```text
This will rewrite 3 local branches to form a stack.

branch-a -> main
branch-b -> branch-a
branch-c -> branch-b

Remote bookmarks will be tracked.
Local mutable copies may be overwritten.

Apply this track plan? [y/N]
```

The wording should stay intentionally direct. This command is useful, but it is
not casual.

## Behavior

1. Validate every branch name with the same branch-name rules used by `jjacks get`.
2. Fetch `origin`.
3. Resolve the base passed to `--onto`.
4. For each branch:
   - If the mutable local bookmark already exists, keep it unless overwrite is
     required and confirmed.
   - If only the remote bookmark exists, import it through the same mutable-copy
     path used by `jjacks get`.
   - Track the corresponding `branch@origin` bookmark so later `jjacks sync`
     can push cleanly.
5. Rebase the stack into the user-provided order.
6. Edit the top branch.

The command should never infer that the user wanted a branch overwritten just
because a remote branch exists. If local and remote differ, the plan should call
that out and confirmation should remain default-No.

## Non-Goals For The First Slice

- No PR number lookup.
- No automatic Graphite metadata import.
- No recursive discovery of stack children.
- No parent picker UI.
- No conflict-resolution helper. jj will surface rebase conflicts in its normal
  way, and the user can continue with existing jj workflows.

## Later Extensions

### Preserve Mode

```sh
jjacks track branch-a branch-b branch-c --onto main --preserve
```

This would import and track the branches but avoid rebasing them. It is useful
when the Git branch ancestry already represents the intended stack and the user
only wants jjacks to adopt the bookmarks.

### Interactive Parent Selection

```sh
jjacks track branch-c
```

This could show candidate parents from local bookmarks or GitHub PR bases and
ask the user to choose. It should come after the explicit ordered form is solid.

### Remote Stack Discovery

```sh
jjacks get branch-c --stack
```

This could discover downstack branches from GitHub PR base branches or Graphite
metadata. That should be a later feature because source-of-truth rules can get
messy when Graphite, GitHub, and local jj ancestry disagree.

## Implementation Notes

The implementation can reuse the new `jjacks get` machinery:

- remote branch lookup through `RepoService.findRemoteHead`
- local and remote bookmark snapshots through `JjService`
- mutable remote import through `importRemoteBookmarkAsMutable`
- tracking repair through `trackRemoteBookmarkToLocal`

New jj behavior likely needed:

```sh
jj rebase -s <branch> -d <parent>
jj edit <top-branch>
```

Add a pure planner first, similar to `src/get.ts`, so the destructive plan can be
unit tested without invoking jj. CLI code should stay thin and only execute the
approved plan.

## Test Plan

- Unit tests for ordered stack planning.
- Unit tests for missing local branches that exist on origin.
- Unit tests for missing remote branches.
- Unit tests for divergent local/remote branches requiring overwrite wording.
- Unit tests for default-No confirmation behavior.
- Integration test with three remote branches imported into a fresh jj repo and
  rebased into the requested shape.
