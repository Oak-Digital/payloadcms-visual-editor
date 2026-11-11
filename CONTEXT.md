# Architecture and terminology

[Back to README](README.md) · [Host integration](README.integration.md) · [Development](CONTRIBUTING.md)

## Scope

`@oak-digital/payload-visual-editor` is Oak's private development fork of the upstream Payload visual editor. It provides an authenticated desktop workspace for canvas/structured editing, block arrangement, shared content, draft saving, publish review, revisions and feedback. REC Watches is the verified host; its storefront, schemas and publication policy live outside this package.

## Core terms

| Term                | Meaning                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owner               | The collection, document ID, draft capability and locale identifying a canvas editing session. Shared-content targets identify a collection document or Global separately.                 |
| Source map          | A flat path-to-value/descriptor map built from schema and document data. Text entries are strings; rich text, uploads, layout relationships and schema controls have typed descriptors.    |
| Editable binding    | `data-payload-path`, optional `data-payload-type` and serialized `data-payload-document` attributes produced by `/utilities`. They identify content; they are not permission to mutate it. |
| Pending session     | An owning document's snapshot/revision plus staged field changes and block operations. Canvas and sidebar share it, including undo/redo and recovery.                                      |
| Stable row identity | Payload row IDs and original source paths retained through reorder, duplication and host preview rendering. Copies receive new IDs.                                                        |
| Revision            | A server fingerprint used to reject stale editing/review/restoration requests. Transactions protect persistence per document.                                                              |
| Publish review      | An in-memory comparison of the proposed draft with published content. It does not write; publication is a separate action.                                                                 |
| Recovery            | Browser storage scoped to authenticated user, owner and locale. Restoration checks the server revision and never publishes.                                                                |
| Annotation          | Feedback about a page element, separate from CMS edits. It may include a screenshot and external ticket reference.                                                                         |

## Data flow

1. The host authenticates a preview request and loads the draft with `context: { contentSourceMap: true }`, `req` and `overrideAccess: false`.
2. The plugin's virtual `_sourceMap` field describes supported paths. `bindSourceMap` attaches per-occurrence ownership before the host filters or transforms rows; `editableField`/`editableValue` forward the bindings to DOM elements.
3. The workspace loads a same-origin canvas iframe and portals editor panels into its sidebar. Selection resolves marked fields and block rows to their owners.
4. Server endpoints resolve the schema, access, locale, relationships and revisions. The client stages values/operations in retained sessions; unsupported or unmapped values remain unavailable.
5. For pending previews, the arrange endpoint prepares a document without writing. The host renders its real blocks and preserves original `rowPaths`. Shared-content preview uses the lightweight `/preview` hook.
6. Draft saving and publication pass through Payload validation/hooks. Documents persist sequentially with per-document outcomes. Preview refresh is separate and can be retried after successful persistence.

`buildSourceMap(fields, document)` maps supported rendered text, populated rich text, uploads and opted-in layout relationships. The internal `controls: true` mode also includes schema-driven controls and empty rich-text fields for forms. The map alone is not a list of authorized writes: endpoints resolve and validate the server schema/access independently.

`createEditableAttrs(sourceMap, owner)` returns a path helper. `bindSourceMap(document, sourceMap, owner, rowPaths?)` clones bound values per occurrence so repeated media references retain separate paths. Referenced documents must use their own source map and owner; matching IDs, URLs or text never establish ownership.

## Code boundaries

| Location                                       | Responsibility                                                                               |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| [src/index.ts](src/index.ts)                   | Plugin configuration, source-map hooks, endpoint/admin-view registration and server exports. |
| [src/utilities.ts](src/utilities.ts)           | Renderer bindings and source-map validation.                                                 |
| [src/exports/client.ts](src/exports/client.ts) | Workspace, toolbar, admin components and public client types.                                |
| [src/components/](src/components/)             | Workspace, arrange/shared-content forms, rich text, media, revisions and publish review UI.  |
| [src/endpoints/](src/endpoints/)               | Authenticated read, preparation and persistence boundaries.                                  |
| [src/utils/](src/utils/)                       | Schema traversal, source maps, operations, revision checks, recovery and validation.         |
| [src/hooks/](src/hooks/)                       | Refresh orchestration and lightweight shared-content preview subscription.                   |
| [src/annotations/](src/annotations/)           | Oak OS settings, encrypted credentials, ticket requests and screenshots.                     |
| [scripts/](scripts/)                           | Build fingerprinting, incremental watcher and watcher tests.                                 |

## Editing paths and limits

The workspace's arrange flow handles scalar values, rich text, media and block operations in one pending session. Shared collections/globals use a separate opted-in editor and publishing scope. Reusable layouts are collection-owned arrange sessions, not page-owned copies until **Make independent** prepares a copy.

The standalone toolbar retains a legacy text/image patch endpoint and a separate native rich-text modal. Those flows do not inherit every workspace guarantee: the patch endpoint lacks arrange revision/transaction checks, and the modal's unsaved changes are not recovered after reload. Rich text always remains Lexical JSON; it never goes through string patches or feedback annotations.

Source maps and editor controls belong only in authenticated previews. Same-origin messages, server collection/shared-content allowlists and document/field access remain required. Multi-document saves are not atomic. The host owns real rendering, draft-session renewal, cache isolation and publication visibility.

## Verification locations

Unit tests are collocated as `src/**/*.test.ts` and selected by [vitest.unit.config.ts](vitest.unit.config.ts). Watcher tests are in [scripts/watch.test.mjs](scripts/watch.test.mjs). REC's feature integration runners live in its `frontend/apps/web/src/lib/visual-editor/`; there are no root `tests/integration/` or `tests/e2e/` suites. Follow [CONTRIBUTING.md](CONTRIBUTING.md) for checks appropriate to each change.
