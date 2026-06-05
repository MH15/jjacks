# jjacks

`jjacks` is a TypeScript CLI for syncing the current `jj` bookmark stack to GitHub pull requests.

## Current scope

- One bookmark maps to one PR.
- Sync only considers the current stack.
- Branch names are derived mechanically from bookmark names.
- PR titles come from bookmark names.
- PR descriptions are never written by the tool.
- Stack comments are used as breadcrumbs across the PR stack.
- `advance-bookmarks.enabled = true` is required.
- `sync` shows a preview first, then prompts for confirmation by default.
- `sync --dry-run` is an explicit preview-only mode.
- `sync --execute` is an explicit non-interactive apply mode.
- The tool will add a stack-link comment to participating PRs.
- Dry-run output includes the planned stack comment body.
- `refresh` updates trunk, restacks any surviving bookmarks onto it, and opens a fresh working copy to continue the remaining stack.
- `up` and `down` move within the current bookmark stack with `jj next` and `jj prev`.

## Commands

- `jjacks doctor`
- `jjacks status`
- `jjacks create <bookmark-name>`
- `jjacks up`
- `jjacks down`
- `jjacks refresh`
- `jjacks diff`
- `jjacks sync --dry-run`
- `jjacks sync`
- `jjacks sync --execute`

## Typical flow

```bash
# Open the next stacked change
node dist/cli.js create my/bookmark

# Preview the current stack before syncing
node dist/cli.js sync --dry-run

# Apply the sync plan with an interactive confirmation prompt
node dist/cli.js sync

# Move around inside the stack while reviewing or editing
node dist/cli.js up
node dist/cli.js down

# After lower PRs merge, refresh trunk and continue the surviving stack
node dist/cli.js refresh
node dist/cli.js sync
```

## Development

```bash
npm install
npm run build
node dist/cli.js doctor
```

## Testing

```bash
npm run check
npm test
npm run build
```

The current tests use fake `Effect` services to validate stack planning without shelling out to `jj` or `gh`.
