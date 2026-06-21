# jjacks

A Jujutsu-backed GitHub stacking tool. Manages one bookmark per GitHub pull request.

## Stack

- **Runtime:** Node.js 22+
- **Language:** TypeScript (compiled with tsup)
- **Framework:** Effect / @effect/cli
- **Test runner:** Vitest

## Build

```bash
npm install
npm run build
```

Compiled output lands in `dist/cli.js` (ESM, executable).

## Other scripts

| Script | Purpose |
|--------|---------|
| `npm test` | Unit tests (no external tools needed) |
| `npm run typecheck` | TypeScript type checking only |
| `npm run lint` | oxlint |
| `npm run check` | typecheck + lint + format check |

## Runtime requirements (outside Replit)

The CLI requires these tools installed locally when actually running `jjacks` commands:
- `jj` (Jujutsu VCS)
- `git`
- `gh` (GitHub CLI, authenticated via `gh auth login`)

## User preferences

- Keep the project's existing structure and stack.
