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
