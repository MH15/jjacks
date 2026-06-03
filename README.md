# jjacks

`jjacks` is a TypeScript CLI for syncing the current `jj` bookmark stack to GitHub pull requests.

## Current scope

- One bookmark maps to one PR.
- Sync only considers the current stack.
- Branch names are derived mechanically from bookmark names.
- PR titles come from bookmark names.
- PR descriptions are never written by the tool.
- `sync` defaults to dry-run behavior unless `--execute` is passed.
- The tool will add a stack-link comment to participating PRs.

## Planned commands

- `jjacks doctor`
- `jjacks status`
- `jjacks sync --dry-run`
- `jjacks sync --execute`

## Development

```bash
npm install
npm run build
node dist/cli.js doctor
```

## Testing

```bash
npm test
```

The current tests use fake `Effect` services to validate stack planning without shelling out to `jj` or `gh`.
