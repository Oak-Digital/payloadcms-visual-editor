# Oak Payload Visual Editor

Oak Digital's development fork of [omaroubari/payloadcms-visual-editor](https://github.com/omaroubari/payloadcms-visual-editor), based on commit `908f6c994ffffc6f704ad5560a1db8bda6f847dc`.

Package: `@oak-digital/payload-visual-editor`. Tested with Payload 3.79.0, Next 16.3.8 and React 19.2.4. Private and unpublished while we test it in REC Watches. The upstream package declares MIT; its original attribution and documentation are preserved in [README.upstream.md](README.upstream.md).

## Develop inside REC Watches

This repository is a submodule at `frontend/packages/payload-visual-editor`. The host uses `workspace:*` and builds this package before type generation and app startup. `pnpm dev --filter web` also starts this package's source watcher. Edit `src/`; JavaScript, declarations and SCSS are rebuilt into `dist/`, and Next reloads the changes. Do not edit generated `dist/` files.

From REC's `frontend/` Nix shell:

```sh
pnpm --filter @oak-digital/payload-visual-editor test:unit
pnpm --filter @oak-digital/payload-visual-editor typecheck
pnpm --filter @oak-digital/payload-visual-editor build
```

For a standalone clone, use `pnpm install --frozen-lockfile`, then the same package scripts without `--filter`. The upstream demo is retained under `dev/` as a reference, with its own dependencies in `dev/package.json`. Install them separately inside `dev/` using `pnpm install --ignore-workspace` if working on that demo. REC is the verified integration target. The plugin workspace deliberately does not install the demo's Next/Payload UI stack.

## Configure

```ts
import { payloadVisualEditor } from '@oak-digital/payload-visual-editor'

payloadVisualEditor({ collections: { pages: true } })
```

Enable native drafts on each selected collection. Request `context: { contentSourceMap: true }` only for authenticated preview reads. Mark rendered text with `createEditableAttrs(document._sourceMap)('field.path')`, then mount `VisualEditorToolbar` from `@oak-digital/payload-visual-editor/client` only in authenticated previews. Pass `documentInfo: { id, collection: 'pages', hasDrafts: true, locale: 'en' }`. Localized hosts must pass a configured locale.

The fork adds block/array source maps, locale-aware saving, collection allowlists, Payload read/update access enforcement, draft/publish separation and patch path validation. Feedback annotations are excluded from CMS mutations. Text, textarea, marked Lexical rich-text fields and single image uploads are supported; read-only/virtual fields and structural metadata are excluded. See [rich-text editing](README.rich-text.md) and [image editing](README.images.md) for integration, safety and limitations.

Saving and publishing use the host's normal Payload hooks and validation. Host publication policies still apply: REC's `publishStatus` must already be Public for a published document to appear publicly. No webhook or agent endpoint is configured by REC.

## Bind shared renderers

Import `bindSourceMap`, `editableField`, and `editableValue` from `@oak-digital/payload-visual-editor/utilities`:

```tsx
const owner = { id: page.id, collection: 'pages', locale: 'en', hasDrafts: true }
const content = bindSourceMap(page, page._sourceMap, owner)
<h2 {...editableField(content.layout[0], 'heading')}>{content.layout[0].heading}</h2>
<img {...editableValue(content.layout[0].image)} src={content.layout[0].image.url} />
```

Bind before filtering or transforming rows. Every occurrence keeps its original field path, even when several fields reference the same media record. Shared image and rich-text renderers can spread `editableValue(resource)`; scalar text uses `editableField(parent, fieldName)`. For a displayed fallback image, spread `editableField(slide, 'imageOverride')` explicitly so replacement creates the override. Optional scalar fields are writable only when the server schema resolves their existing parent.

Bindings include the owning document and locale. The toolbar groups pending changes by owner, and image previews distinguish identical paths in different documents. Saving several documents is sequential, not atomic; an error reports that earlier documents may already have saved. Only bind referenced documents whose collections are enabled and support drafts. Never attach a parent page's path to unrelated content.

Without a source map, binding leaves content unchanged. Unmapped preview selections explain that they cannot be edited here. Hardcoded copy, calculated commerce values and unbound shared content require host integration; the editor never guesses ownership from text or an image URL.

## Git workflow

The development branch is `codex/rec-integration`. Commit and push changes here first, then commit the updated submodule pointer in REC. To compare upstream:

```sh
git remote add upstream https://github.com/omaroubari/payloadcms-visual-editor.git # once
git fetch upstream
git diff HEAD..upstream/main
```

Do not commit credentials, local database content or generated output.

Restart `pnpm dev` after changing server plugin configuration or endpoint handlers: the host keeps Payload server modules outside its development bundle. Toolbar/style edits rebuild through the watcher.

## Arrange & edit

Choose the blocks icon in the toolbar to open a persistent editing panel. Select outlined text or images on the page (keyboard: focus a field and press Enter), edit several items, and review or undo individual pending changes. Rich-text fields keep their configured Lexical editor in the sidebar and queue changes as you type; image selections also remain pending. Choose **Standard** or **Large** under **Sidebar size** without losing pending edits. Plain text and images preview immediately. Formatted text refreshes on the page after saving.

The Blocks list defaults to Edit mode: selecting a block scrolls its page section into view and opens its controls. Rearrange mode shows drag handles and move up/down buttons instead. Switching modes retains pending edits and ordering changes. Hosts opt in by wrapping a block list with `data-payload-block-list="layout"` and `data-payload-document`, then wrapping each direct child with `data-payload-block-id` containing its stable Payload row ID. The list must render all rows in source order and use a column flex/grid layout for the pending order preview. Public pages do not need these attributes or wrappers.

**Save draft** saves pending content and order changes together and refreshes the preview without navigation. **Publish all** publishes the changed documents' full drafts, including drafts saved through this panel. Closing the panel retains pending changes in memory; leaving or reloading warns before discarding them. Pending work is not persisted across browser reloads.

The `/payload-visual-editor/arrange` endpoint validates collection/field access, upload restrictions, Lexical round trips, and exact block-ID permutations. Each document uses a version check and transaction; field edits apply before block reordering. A stale snapshot is rejected without saving. Multiple owning documents save sequentially, not atomically; partial failures report completed documents and require reloading before further edits.

## Workspace

`VisualEditorWorkspace` from the `/client` export surrounds an authenticated preview with a persistent frame, searchable content navigation, desktop/mobile preview widths, editing tools, and the existing contextual editor. Supply `documentInfo` and `sources` (`slug`, `label`, optional `titleField` and `previewURL(document)`). Sources without a preview resolver open the native collection editor in a new tab; `global: true` opens that Global's native editor. Listing uses Payload's REST API and its access checks.

The workspace renders a same-origin iframe so responsive styles and fixed elements use the preview's actual viewport. The canvas portals its editing panel, history controls and save actions into the floating Oak sidebar. Rich text, the media library and feedback notes use layered sidebar views with a Back action. Host the component only in authenticated draft previews. The `visual-editor-canvas=1` query parameter provides the standalone toolbar for integration tests; it does not grant preview access.

Switching pages with pending changes offers **Keep editing** or **Discard and switch**. Save first to retain changes across pages. Navigating while saving is blocked. Drafts are still saved per owning document through the existing editor; navigation does not batch-publish the site. The Oak dot expands into a taller charcoal workspace containing content navigation, editing modes, page blocks, annotations, shared content, preview widths and Revisions. Save draft, Publish all and undo/redo stay in its footer. Settings place both dot and sidebar at Top right or Right bottom, and control width and reduced motion. Press E to toggle; Escape goes back a layer, then collapses. Collapsing and changing views preserve pending edits. The revisions panel lists unsaved changes and saved page versions with before/after comparisons through Payload’s access-controlled versions API. Older history loads on demand. Saving refreshes history; referenced documents retain their own revision histories. Opted-in shared content uses the editor below; agent chat is outside this phase.

In Edit content mode, text and textarea fields can be edited directly on the canvas. Canvas and sidebar edits share pending values, undo/redo and save/publish actions. Formatted rich text keeps its native sidebar editor. The footer reports unsaved changes, saving, publishing, preview refresh and failures; successful status remains visible when navigating between fields.

## Shared collections and globals

Opt in document roots on the server; mark matching workspace sources `editable: true` on the client:

```ts
payloadVisualEditor({
  collections: { pages: true },
  sharedContent: {
    navigation: {
      fields: ['title', 'navItems'],
      rowLabels: { navItems: 'link.label', 'navItems.*.subMenu': 'link.label' },
    },
    footer: { global: true, fields: ['layout'] },
  },
})
```

The workspace reads Payload field schemas for text, textarea, email, numbers, checkboxes, select/radio, single relationships, groups, arrays and blocks. Arrays use schema limits and stable row IDs. Conditional fields and field permissions are evaluated on the server. Unsupported fields remain in Payload; updates preserve other document fields. Relationship pickers search accessible documents with pagination; enabled related content opens another retained editor session.

Shared edits have their own persistent footer and undo/redo history. Save draft saves dirty shared documents; Publish all reviews and publishes the full drafts of the listed shared documents. Page edits remain separate. Saves are transactional per document; if a later document fails, earlier successful saves remain saved and remaining edits stay available. Revision checks reject stale edits. A database with transaction support is required. Sources without drafts expose publication only.

Host renderers subscribe with `useSharedContentPreview` from `@oak-digital/payload-visual-editor/preview`. It returns same-origin workspace messages containing `{ target, document, focusPath }`. Documents include accessible populated relationships; the host chooses how to render them and reveal the selected region. No REC schema or storefront styling is built into the plugin. The standalone preview export avoids pulling editor controls into public storefront bundles. Shared-content persistence uses `/api/payload-visual-editor/shared-content` with Payload access checks, validation and hooks.

Draft loaders in each host must bypass public caches only for authenticated preview sessions. Collections that previously saved immediately need their existing development content initialized with the intended publication status when enabling drafts. No legacy schema fallback is provided.
