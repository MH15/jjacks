## Vendored Repositories

This project vendors external repositories under `@repos/`.

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `@repos/` unless explicitly asked.
- Do not import from `@repos/`; application code should continue importing from normal package dependencies.

When writing Effect code for this project, inspect `@repos/effect/` for examples of idiomatic usage, tests, module structure, and API design.

- Start with `@repos/effect/packages/effect/`, `@repos/effect/packages/cli/`, and `@repos/effect/packages/platform-node/` for the libraries used in this repo.
- Use `@agent-patterns/effect-jjacks.md` as a quick reference before diving into the vendored source.
