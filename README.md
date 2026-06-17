# jjacks

`jjacks` is a Jujutsu-backed GitHub stacking tool following a strict mental model of one "bookmark" per Pull Request.

## Who's this for?

Why do we need another stacking tool? There's already [Graphite](https://graphite.com/docs/cli-overview) and a dozen other GitHub stacking tools. While learning [Jujutsu](https://github.com/jj-vcs/jj), the amend-only workflow felt underused when working with GitHub. In `jjacks`, if you're on a bookmark you'll see the diff at all times.

## Install

`jjacks` is packaged as a Node CLI. Install it globally:

```bash
npm install --global jjacks
```

For local development from a checkout:

```bash
npm install
npm run build
npm link
```

## Shell Completions

`jjacks` can generate shell completion scripts:

```bash
source <(jjacks --completions zsh)
source <(jjacks --completions bash)
jjacks --completions fish | source
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

New pull requests are created with an empty description by default. To use the repo's default pull request template when `jjacks sync` creates PRs:

```bash
jj config set --repo jjacks.pull_requests.use_template true
```

## Commands

- `jjacks doctor`
- `jjacks status`
- `jjacks create <bookmark-name>`
- `jjacks get <branch-name>`
- `jjacks up`
- `jjacks u`
- `jjacks down`
- `jjacks d`
- `jjacks log`
- `jjacks diff`
- `jjacks sync`
- `jjacks sync --dry-run`
- `jjacks sync --execute`
- `jjacks merge`

## Getting Remote Branches

Use `get` when someone else pushed a branch and you want to adopt it into your local `jj` workspace:

```bash
jjacks get feat/coworker-branch
```

`jjacks get <branch-name>` prints a plan and asks before fetching or editing local state. If a local bookmark with the same name already exists and points somewhere else, the prompt clearly says it will overwrite that bookmark and defaults to `No`.

Use `get` on the default branch when you want a fresh trunk continuation without syncing or pushing your current stack:

```bash
jjacks get main
```

This fetches origin, moves the local default branch bookmark to its remote, and continues from that default branch using the same clean working-copy behavior as `jjacks down`.

To preview without changing local state:

```bash
jjacks get feat/coworker-branch --dry-run
```

## Sync Modes

`jjacks sync` builds a plan, prints it, and asks before applying changes.

`jjacks sync --dry-run` prints the plan without changing local state or GitHub.

`jjacks sync --execute` applies the plan without prompting. It may fetch, move the local default bookmark, push stack bookmarks, create or edit pull requests, and update stack breadcrumbs.

## Local Telemetry

`jjacks` records local command timing telemetry to `.jjacks/telemetry/commands.jsonl` inside the repo. The directory is gitignored and is intended for local performance analysis.

Generate a static HTML report from the collected data:

```bash
npm run telemetry:report
```

The report is written to `.jjacks/telemetry/report.html`.
It is a static file with no build step; the browser loads Chart.js from `esm.sh` when you open it.

## Docs

- [Tutorial](./docs/tutorial.md)
- [Open questions](./docs/open_questions.md)

## Notes

- The supported workflow is one `jj` bookmark per GitHub pull request.
- `sync --execute` is intentionally direct: if a network or GitHub step fails, rerun `jjacks status` and `jjacks sync` after fixing the underlying issue.
- Broader multi-stack management and unusual `jj` topologies are still beta territory.
