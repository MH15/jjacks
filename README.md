# jjacks

`jjacks` is a Jujutsu-backed GitHub stacking tool.

It is currently a repo-local CLI, not a published npm package. The main job is to take the current `jj` bookmark stack and keep the matching GitHub pull requests in sync.

## Current shape

- One bookmark maps to one PR.
- Sync works from the current active stack.
- Bookmark names drive branch names and PR titles.
- `sync` can preview, push, create PRs, retarget PRs, and update stack comments.
- `refresh` restacks surviving work onto fresh trunk and opens a continuation working copy.

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
