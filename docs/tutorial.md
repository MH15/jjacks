# jjacks Tutorial

This tutorial is for the current shape of `jjacks`: a repo-local CLI that helps turn a `jj` bookmark stack into a GitHub PR stack.

## Mental Model

- `main` is trunk.
- You usually sit on an empty working copy on top of `main` or on top of the tip of a stack.
- `jjacks create <bookmark>` turns the current working copy into the next named layer in the stack.
- `jjacks sync` looks at the current active stack and reconciles GitHub to match it.

## Example Stack Shape

Here is one useful stacked-review shape:

- the first PR branches from `main`
- that PR has two children
- one of those children has its own child

### Bookmark Topology

```mermaid
graph TD
    main["main"]
    base["feat/base"]
    api["feat/api"]
    ui["feat/ui"]
    polish["feat/ui-polish"]

    main --> base
    base --> api
    base --> ui
    ui --> polish
```

You can read that as:

- `feat/base` is the first review layer off trunk
- `feat/api` and `feat/ui` both depend on `feat/base`
- `feat/ui-polish` depends on `feat/ui`

### PR Base Relationships

When synced to GitHub, the intended PR bases look like this:

```mermaid
graph LR
    pr1["PR 1: feat/base"]
    pr2["PR 2: feat/api"]
    pr3["PR 3: feat/ui"]
    pr4["PR 4: feat/ui-polish"]
    main["main"]

    pr1 -->|base| main
    pr2 -->|base| pr1
    pr3 -->|base| pr1
    pr4 -->|base| pr3
```

That means:

- `feat/base` targets `main`
- `feat/api` targets `feat/base`
- `feat/ui` targets `feat/base`
- `feat/ui-polish` targets `feat/ui`

### Why This Shape Helps

This kind of stack is useful when one shared foundation needs to land first, but the follow-up work can still be reviewed in parallel:

- reviewers can look at `feat/api` separately from `feat/ui`
- `feat/ui-polish` stays small and only includes the delta from `feat/ui`
- if `feat/base` changes, the rest of the stack can be retargeted and refreshed from that shared layer

### After The Base PR Merges

Once `feat/base` lands in `main`, the surviving children should be restacked so they no longer point at the merged layer.

```mermaid
graph TD
    main["main (now includes feat/base)"]
    api["feat/api"]
    ui["feat/ui"]
    polish["feat/ui-polish"]

    main --> api
    main --> ui
    ui --> polish
```

And the intended PR bases become:

```mermaid
graph LR
    pr2["PR 2: feat/api"]
    pr3["PR 3: feat/ui"]
    pr4["PR 4: feat/ui-polish"]
    main["main"]

    pr2 -->|base| main
    pr3 -->|base| main
    pr4 -->|base| pr3
```

That is the core idea behind `jjacks refresh`:

- merged lower layers disappear from the active stack
- surviving child work is rebased onto fresh trunk
- PR bases are updated to match the new stack shape

## Before You Start

You need:

- a Git repo that is also a `jj` repo
- a configured GitHub remote
- `gh` auth that can create and edit pull requests
- `advance-bookmarks.enabled = true`

## Config

`jjacks` reads its settings from JJ config instead of a separate `.jjacks.config.js` file.

That means you can use JJ's normal config scopes:

- user
- repo
- workspace

To see the exact config file path JJ is using for a given scope:

```bash
jj config path --user
jj config path --repo
jj config path --workspace
```

Typical JJ config locations:

- user config on macOS: `$HOME/Library/Application Support/jj/config.toml`
- repo config: `.jj/repo/config.toml`
- workspace config: use `jj config path --workspace` for the current workspace

`jjacks` follows JJ's normal config resolution, so the effective value is the same one you would get from `jj config get`.

### Supported `jjacks` Keys

#### `jjacks.stack_comments.location`

Controls where `jjacks` writes the stack breadcrumb block for synced pull requests.

Supported values:

- `comment`
- `description`

Behavior:

- `comment` writes the stack block as a dedicated PR comment
- `description` writes the stack block into the PR description body and keeps it updated there

Default:

```toml
[jjacks.stack_comments]
location = "comment"
```

Set it with JJ:

```bash
jj config set --user jjacks.stack_comments.location description
```

Or at repo scope:

```bash
jj config set --repo jjacks.stack_comments.location description
```

## Common Flow

### 1. Start from clean trunk

The happy-path starting point is:

- `main` matches `origin/main`
- your working copy is an empty scratch change on top of `main`
- `jjacks status` says there is no active bookmark stack yet

That empty working copy is normal. `jjacks` should treat it as the place where the next bookmark begins.

### 2. Create the first bookmark

Create a named layer from the current working copy:

```bash
jjacks create feat/my-change
```

After that:

- the current working copy should carry the `feat/my-change` bookmark
- your code changes should still be on that same change
- `jjacks status` should show one active stack entry

### 3. Add more stacked layers

Once the current change is where you want it, open the next layer and name it:

```bash
jjacks create feat/my-follow-up
```

The intent is one bookmark per reviewable PR layer.

### 4. Review the GitHub plan

Run:

```bash
jjacks sync
```

Before applying changes, `jjacks` should show the plan and ask for confirmation.

The preview should tell you, for each active stack entry:

- whether the bookmark needs to be pushed
- whether a PR will be created
- whether an existing PR title or base will be updated
- what stack comment changes are planned

### 5. Apply the plan

When the preview looks right, answer `Y` to apply it.

For a non-interactive apply:

```bash
jjacks sync --execute
```

## Moving Around the Stack

Use:

- `jjacks up`
- `jjacks down`

These move between bookmarks in the current bookmark lane.

They should follow the current bookmark lane rather than jumping around unrelated descendants elsewhere in the repo.

If a bookmark has multiple child bookmarks above it, `jjacks up` should prompt you to choose which child bookmark to continue from.

## Refreshing After Lower PRs Merge

When lower layers merge and trunk moves:

```bash
jjacks refresh
```

The intended behavior is:

- fetch fresh trunk
- restack any still-open work onto it
- leave you on a continuation working copy ready to keep going

If no stack remains, `refresh` should leave you on a clean working copy above `main`.

## Status Expectations

`jjacks status` is meant to answer one question: what does the current active stack look like right now?

It should not treat unrelated bookmarks elsewhere in the repo as part of your current stack.

Examples:

- empty scratch working copy on `main` -> no active bookmark stack
- one bookmarked change on `main` -> one active stack entry
- multiple bookmarked descendants in the current lane -> ordered active stack entries

## Current Non-Goals

Right now `jjacks` is still intentionally narrow:

- no npm package release yet
- no PR body authoring
- no generalized multi-stack repo management UI
- no attempt to model every possible `jj` topology

The goal at this stage is a reliable happy path for a bookmark-based GitHub stacking workflow.
