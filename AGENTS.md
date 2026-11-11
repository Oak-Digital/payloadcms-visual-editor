# Visual Editor plugin guidance

## Scope and references

- This package is `@oak-digital/payload-visual-editor`, Oak's development fork of the upstream Payload visual editor. Keep it reusable across Payload hosts; REC-specific schemas, routes, publication policies and storefront rendering belong in the host application.
- Start with [README.md](README.md), then use [README.integration.md](README.integration.md) for host integration, [README.editing.md](README.editing.md) for editing flows and [CONTRIBUTING.md](CONTRIBUTING.md) for development and verification. Consult [README.rich-text.md](README.rich-text.md) and [README.images.md](README.images.md) when changing those features; verify older examples against the current code.
- Use the [Payload CMS skill](.agents/skills/payload/SKILL.md) and its [reference docs](.agents/skills/payload/reference/) for Payload API, schema, access-control and plugin changes.
- Preserve upstream attribution in `README.upstream.md`. Update the relevant integration documentation when changing public exports, configuration, DOM attributes or preview events.

## Package structure and boundaries

- Edit `src/`; `dist/` contains generated JavaScript, declarations and copied styles. Do not edit or commit build output.
- `src/index.ts` registers the server plugin, source-map hooks and endpoints. Preserve the host's existing fields, hooks, endpoints and admin configuration.
- `src/components/` contains the workspace, toolbar and layered editors; `src/hooks/` handles preview refresh and shared-content preview. Reuse the existing UI primitives, icons and SCSS modules.
- `src/endpoints/` owns authenticated reads and mutations. `src/utils/` owns schema traversal, source mapping, revisions, recovery and edit operations; keep these rules out of UI-only code.
- Keep server, `/client`, `/utilities` and `/preview` entry points separate. The lightweight `/preview` hook must not pull editor controls into public storefront bundles. Check `package.json` exports when changing the package API.
- Follow the package's `.prettierrc.json` and nearby TypeScript/SCSS conventions. Storefront Tailwind guidance does not require converting the plugin's editor styles.
- `dev/` is the retained upstream demo with separate dependencies. REC's `frontend/apps/web/` is the verified integration target; do not assume demo scripts exercise the current host integration.

## Editing and persistence

- Identify edits by owning document, collection or global, locale and field path. Bind source maps before filtering or rearranging rows; preserve stable row IDs and original editing paths through reorder, duplication, undo and preview rendering.
- Never infer ownership from matching text, image URLs or media IDs, and never assign a parent page's paths to referenced content. Unmapped or unsupported fields should remain explicitly unavailable for editing.
- Canvas and sidebar controls must share pending values and undo/redo state. Preserve pending edits across selection, drawer navigation, resizing, collapsing and preview failures; discard them only through the established explicit discard flow.
- Keep Save draft, publish review and publication distinct. Review and pending-preview requests must not write documents or versions. Native media upload is a separate immediate write and must remain clear to the user.
- Preserve revision checks and per-document transactions in flows that use them. Multi-document saves are sequential, not atomic: retain successful outcomes and unsaved work after partial failures, and do not replay successful publications on retry.
- Scope recovery to the authenticated user, owning document and locale. Reject stale recovery against newer server revisions; restoring browser edits must not publish content.
- Keep rich text as Lexical JSON using the target field's configured editor and node classes. Reject lossy conversions; do not route rich text through plain-text patches or feedback annotations.

## Access and preview integration

- Enforce authentication, configured collection/shared-content allowlists, document and field access, and configured locales on the server. Pass the authenticated `req` and `overrideAccess: false` to user-facing Payload Local API operations; preserve host validation and hooks.
- Resolve writable paths and field constraints from the server schema. Validate nested fields, block types, row limits, relationships and upload restrictions; do not trust client paths or permit structural metadata/prototype mutations.
- Keep editor controls, source maps and editable DOM bindings restricted to authenticated previews. A canvas query parameter is not authorization. Validate the origin of workspace/iframe messages.
- Keep the host responsible for rendering real blocks, renewing draft sessions and bypassing public caches for authenticated previews. Respect the existing preview bridge: ignore stale results, preserve the last successful rendering on failure, and retain original row paths.
- Separate persistence from preview refresh. A refresh failure after a successful save should offer a refresh-only retry, preserving the saved outcome.
- Keep Payload UI, Lexical, Next and React aligned with the host's peer dependencies; avoid duplicate runtime instances and admin contexts.

## Visual editor UX

- The Visual Editor interface is desktop-only; do not optimize its controls or layout for use on mobile devices. Preserve Desktop/Mobile preview-width controls and mobile website previews inside the desktop editor. The host storefront must remain responsive.
- Show block-specific controls only after that block is selected. Use layered views with a clear Back action instead of displaying every control together. Place Back beside the title in a single aligned header row.
- Animate drawer view changes briefly and respect reduced-motion preferences. Preserve pending edits when navigating between views.
- Keep editor cards equal in height with consistent gaps and padding. Keep titles on one line, truncate overflow with an ellipsis, and expose the full title on hover.
- Keep labels and actions simple. Omit redundant instructions and explanatory copy when the controls are self-explanatory.
- Preserve keyboard selection, focus handling and Escape/Back navigation when changing panels. Keep save state and actionable errors visible without clearing pending work.

## Development and verification

- In REC, use the host's `frontend/` Nix environment and pnpm scripts guidance. The host development command builds this package and starts its source watcher. Restart the host dev server after server plugin configuration or endpoint changes.
- In REC, select the applicable profiles with `pnpm verify:visual-editor <profiles>` from `frontend/`; use `--plan` to review the checks and `--integration` to execute the affected host runners. Follow `frontend/scripts/README.visual-editor-verification.md` in the host repository. Combine profiles when behavior crosses boundaries.
- Plugin behavior changes require unit tests and a build; styles/assets only require a build plus relevant visual verification. The build already checks TypeScript while emitting declarations, so do not also run a separate plugin typecheck. Standalone clones use `pnpm test:unit` and `pnpm build`; tooling changes also use `pnpm test:watch`. Tests live beside the source as `src/**/*.test.ts` and use `vitest.unit.config.ts`.
- Reuse successful unchanged Turbo checks. Integrations are never cached; report unrun integration/manual checks rather than treating a static-only run as full verification.
- Add or update focused regression tests for changed editing, access, revision or persistence behavior. Cover affected failure paths as well as successful saves; avoid tests that merely mirror implementation details.
- For integration changes, also verify the affected REC runner under `frontend/apps/web/src/lib/visual-editor/` and the relevant host checks. Inspect runners before execution; they may create disposable content and require a running local server and transaction-capable database.
- For visible changes, exercise the editor at desktop window sizes and check both desktop and mobile website preview widths. Verify keyboard navigation, pending edits across drawer transitions, undo/redo, save/publish and refresh behavior as relevant. Confirm public pages remain free of editor controls and editing attributes.
- For documentation-only changes, check the diff and referenced paths; an application build is unnecessary. Report verification blocked by unavailable services or dependencies.

## Submodule workflow

- In REC, this directory is a separate Git repository on `codex/rec-integration`. Check both repositories' status and preserve unrelated changes.
- Commit plugin changes here first, then commit the updated submodule pointer and any related host changes in REC. Use REC's commit-message standards when working in that host.
- When publishing the work, push the plugin commit before the parent commit so the submodule reference is fetchable. Do not change upstream remotes or publish the package as part of routine implementation.
