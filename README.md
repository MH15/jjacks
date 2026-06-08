# jjacks

`jjacks` is a Jujutsu-backed GitHub stacking tool following a strict mental model of one "bookmark" per Pull Request.

## Who's this for?

Why do we need another stacking tool? There's already [Graphite](https://graphite.com/docs/cli-overview) and a dozen other GitHub stacking tools. While learning [Jujutsu](https://github.com/jj-vcs/jj), the amend-only workflow felt underused when working with GitHub. In `jjacks`, if you're on a bookmark you'll see the diff at all times.

## Install

`jjacks` is packaged as a Node CLI. Until the first npm release is published, install from a local checkout:

```bash
npm install
npm run build
npm link
```

After a package release, install it globally:

```bash
npm install --global jjacks
```

Requirements:

- Node.js 22 or newer
- `git`
- `jj`
- GitHub CLI `gh`
- `gh auth login` completed for the target GitHub host

## Setup

Use a Git repo that has been initialized for `jj`:

```bash
jj git init --colocate
```

`jjacks` requires bookmark movement to be enabled:

```bash
jj config set --user advance-bookmarks.enabled true
```

Stack breadcrumbs are written as PR comments by default. To write them into PR descriptions instead:

```bash
jj config set --repo jjacks.stack_comments.location description
```

## Commands

- `jjacks doctor`
- `jjacks status`
- `jjacks create <bookmark-name>`
- `jjacks up`
- `jjacks down`
- `jjacks diff`
- `jjacks sync`
- `jjacks sync --execute`
- `jjacks merge`

## Sync Modes

`jjacks sync` builds a plan, prints it, and asks before applying changes.

`jjacks sync --dry-run` prints the plan without changing local state or GitHub.

`jjacks sync --execute` applies the plan without prompting. It may fetch, move the local default bookmark, push stack bookmarks, create or edit pull requests, and update stack breadcrumbs.

## Docs

- [Tutorial](./docs/tutorial.md)
- [Open questions](./docs/open_questions.md)

## Notes

- The supported workflow is one `jj` bookmark per GitHub pull request.
- `sync --execute` is intentionally direct: if a network or GitHub step fails, rerun `jjacks status` and `jjacks sync` after fixing the underlying issue.
- Broader multi-stack management and unusual `jj` topologies are still beta territory.
