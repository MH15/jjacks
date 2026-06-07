# Effect patterns for jjacks

This file is a compact reference for writing Effect code in this repo. It is intentionally practical rather than exhaustive.

## Read first

- `repos/effect/packages/effect/src/Effect.ts` for generator-based composition patterns.
- `repos/effect/packages/effect/src/LayerMap.ts` for `Context.Tag` and `Layer.succeed` examples.
- `repos/effect/packages/cli/README.md` for `Command.make`, `Args`, `Options`, and `Command.run`.
- `repos/effect/packages/platform-node/src/NodeContext.ts` for `Layer.mergeAll` composition patterns.

## Patterns to follow here

- Model services with `Context.Tag(...)` and expose a small interface.
- Build live implementations as plain objects and lift them with `Layer.succeed(...)`.
- Compose CLI and service workflows with `Effect.gen(function* () { ... })`.
- Assemble the app environment with `Layer.mergeAll(...)`.
- Keep command handlers thin: resolve services, run effects, and delegate rendering to helpers.

## Local examples

- `src/services/ProcessService.ts` shows the service-tag plus `Layer.succeed(...)` pattern used throughout the repo.
- `src/cli.ts` shows the repo's preferred command shape with `Command.make(...)`, `Options`, `Args`, and `Effect.gen(...)`.

## What to avoid

- Do not import code from `repos/effect`; it is reference material only.
- Do not replace existing `Effect.gen(...)` flows with ad hoc promise chains unless there is a strong reason.
- Do not introduce new service wiring styles when an existing `Context.Tag` plus `Layer.succeed` pattern already fits.
