---
name: jjacks setup
description: How the jjacks project is structured and run in Replit
---

jjacks is a Node.js/TypeScript CLI that syncs jj bookmark stacks with GitHub PRs.

- It is a command-line tool, NOT a web app: no frontend, no backend server, no port 5000 workflow, no deployment config.
- Requires Node.js >= 22 (package.json engines). Use the `nodejs-22` module.
- Build: `npm run build` (tsup -> dist/cli.js). Run: `node dist/cli.js` or `npm start`.
- Tests: `npm test` (vitest, excludes integration). Checks: `npm run check` (typecheck + oxlint + oxfmt).
- Runtime use requires `git`, `jj`, and GitHub CLI `gh` to be installed by the end user.
