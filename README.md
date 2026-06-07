# jjacks

`jjacks` is a Jujutsu-backed GitHub stacking tool following a strict mental model of one "bookmark" per Pull Request.

## Who's this for?

Why do we need another stacking tool? There's already [Graphite](https://graphite.com/docs/cli-overview) and a dozen other GitHub stacking tools. While learning [Jujutsu](https://github.com/jj-vcs/jj) the ammend-only workflow felt underused when working with GitHub. In `jjacks`, if you're on a bookmark you'll see the diff at all times.



## Commands

- `jjacks doctor`
- `jjacks status`
- `jjacks create <bookmark-name>`
- `jjacks up`
- `jjacks down`
- `jjacks refresh`
- `jjacks diff`
- `jjacks sync`
- `jjacks sync --execute`

## Docs

- [Tutorial](./docs/tutorial.md)

## Notes

- `advance-bookmarks.enabled = true` is required.
- There is no npm release yet, so expect local-repo usage while the workflow settles.
