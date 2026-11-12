# Development and verification

[Back to README](README.md) · [Architecture](CONTEXT.md) · [Repository guidance](AGENTS.md)

## Standalone checkout

Use Node 24 or newer and the pnpm version declared in [package.json](package.json) (currently 10.30.0):

```sh
pnpm install --frozen-lockfile
pnpm test:unit
pnpm build
pnpm dev
```

`pnpm dev` watches the package; it does not start a website. Edit `src/`. JavaScript, declarations and copied styles are generated in `dist/`; do not edit or commit that output.

| Command                        | Purpose                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `pnpm test` / `pnpm test:unit` | Vitest tests in `src/**/*.test.ts` using `vitest.unit.config.ts`.                                 |
| `pnpm build`                   | Copy assets, check TypeScript/emit declarations, compile with SWC and record a build fingerprint. |
| `pnpm dev`                     | Watch runtime files/assets and run a separate declaration watcher.                                |
| `pnpm test:watch`              | Node tests for watcher startup reuse, incremental updates and error recovery.                     |
| `pnpm typecheck`               | Type feedback during iteration; redundant after a successful build.                               |
| `pnpm lint`                    | ESLint.                                                                                           |

The retained upstream demo is in `dev/`, with its own dependencies and scripts in [dev/package.json](dev/package.json). Install its dependencies separately inside `dev/` with `pnpm install --ignore-workspace` if working on it. Its older test/configuration files are not the verified host workflow; the root package has no `test:int` or `test:e2e` scripts.

## Develop in REC Watches

REC integrates this repository as `frontend/packages/payload-visual-editor`, using `workspace:*`. Use REC's `frontend/` Nix environment and host pnpm guidance. `pnpm dev --filter web` builds the plugin before type generation/app startup and starts its source watcher. Next reloads changed package output.

Restart the host dev server after plugin configuration or endpoint changes: the host keeps Payload server modules outside its development bundle. Runtime/style edits rebuild through the watcher. Keep REC schemas, routes, publication policies and storefront rendering in REC.

From REC's `frontend/`, choose verification profiles by changed behavior:

```sh
pnpm verify:visual-editor docs
pnpm verify:visual-editor ui --plan
pnpm verify:visual-editor ui --integration
pnpm verify:visual-editor editing --runner rich-text --integration
pnpm verify:visual-editor persistence host --integration
pnpm verify:visual-editor tooling
```

The host's `frontend/scripts/README.visual-editor-verification.md` defines profiles and runners. Combining profiles deduplicates checks; `--runner` replaces the default runner selection. Without `--integration`, the workflow only runs static checks and reports integrations as unrun. Inspect runners before executing them: they can create disposable content and need a local server, transaction-capable database and sometimes existing fixtures.

## Match verification to the change

- Documentation only: review the diff, examples, links and referenced paths. No application build is needed.
- Styles/assets only: build and visually verify the affected editor flow.
- Behavior: focused regression tests, unit suite and build; run affected host integration checks when applicable.
- Tooling: also run `pnpm test:watch` (and host verification tests if that workflow changes).

The build already checks TypeScript. Reuse successful unchanged Turbo checks; browser/database integrations are never cached. Report service blockers and unrun integration/manual checks explicitly.

For visible changes, use a desktop editor window and check both desktop and mobile website preview widths. Exercise keyboard/focus navigation, pending edits through drawer transitions, undo/redo, saving, publication and refresh as relevant. Confirm public pages have no editor controls or editing attributes.

## Watcher behavior

A completed build records input/output fingerprints in `dist/.watch-build.json`. The watcher reuses matching output at startup, including output restored by Turbo. Missing or changed inputs/outputs trigger a full initial build. Runtime edits compile incrementally; assets are copied; test edits do not rebuild runtime output. Declaration checking runs separately.

Restart the watcher after build configuration or dependency changes. [Watcher measurements](README.watcher.md) document one local before/after benchmark, not a startup or refresh guarantee.

## Repository and submodule workflow

A standalone checkout is independent of REC. In REC, the plugin is a separate Git repository (the integration branch is `main`); check both statuses and preserve unrelated work. Commit plugin changes first, then the updated REC submodule pointer and related host changes. Push the plugin commit before the parent commit so the pointer is fetchable. Follow REC's commit-message standards when working there.

Do not publish the package, change upstream remotes, or commit credentials, local database content or generated output as part of routine changes. Preserve upstream attribution in [README.upstream.md](README.upstream.md).
