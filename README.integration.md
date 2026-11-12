# Host integration

[Back to README](README.md) · [Editor guide](README.editing.md)

The host owns authentication, preview routes, real block rendering, cache bypass and publication policy. The plugin supplies editing controls and access-checked endpoints. REC Watches is the integration reference; its schemas and routes are not plugin requirements.

## Configure the server

Add the plugin to the host's existing `plugins` array:

```ts
import { payloadVisualEditor } from '@oak-digital/payload-visual-editor'

payloadVisualEditor({
  collections: { pages: true },
})
```

Enable `versions: { drafts: true }` on each canvas-editable collection. Existing documents need saved versions. Use a transaction-capable database for arrange editing, rich text, shared content and restoration; MongoDB requires a replica set. Keep Payload, its UI/Lexical packages, React and Next aligned with the package's [peer dependencies](package.json). Regenerate the host's Payload types and admin import map after enabling the plugin, then restart its server.

| Option          | Purpose                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `collections`   | Collection slugs mapped to `true`; enables source maps and canvas endpoint access.                                       |
| `pageSettings` | Per-collection settings roots, sections, SEO preview and language/publication policy callbacks; see below. |
| `sharedContent` | Opts collection/global roots into the separate shared-content editor; see below.                                         |
| `annotations`   | `true` or `{ settingsAccess }` to register Oak OS settings and endpoints. See [annotation setup](README.annotations.md). |
| `disabled`      | Skips endpoint/admin-view/annotation registration. Configured collection source-map fields and hooks are still added.    |

The plugin preserves existing fields, hooks, endpoints and admin configuration. It adds the virtual `_sourceMap` field to enabled collections and the `visualRichText` admin view at `<admin route>/visual-rich-text`. With annotations enabled, `visual-editor-settings` is a plugin-owned Global.

## Page settings and languages

Opt a workspace source into `pageSettings: true`, then configure the matching server `pageSettings[collection]`. `fields` lists editable field roots, `sections` groups them, and optional `searchPreview(document, locale, req)` (sync or async) produces the SEO preview. Fields use the existing schema controls and access checks; nonlocalized fields show **All languages**.

Provide `previewURL(document, locale)` to enable the single-preview language selector. The authenticated `/payload-visual-editor/workspace` endpoint discovers configured, offered locales by document ID with fallback disabled. Optional `hasContent(document)` marks untranslated locales. `availability({ document, locale, published, req })` returns `{ public, label, url? }` using the host's actual publication policy. The editor shows current availability and the expected public outcome in publish review. Review and language discovery do not write content or versions.

The host must support authenticated preview resolution by document identity, including empty translations and changed slugs.

## Authenticate preview reads

Only request source maps after the host has verified both the user and their preview session. `contentSourceMap: true`, Next draft mode and `visual-editor-canvas=1` do not authorize access on their own.

Inside an authenticated host boundary with a Payload request (`req`), a draft read looks like this. `pageId` and `locale` come from the host's validated route/session:

```ts
if (!req.user) throw new Error('Authentication required')

const page = await req.payload.findByID({
  collection: 'pages',
  id: pageId,
  draft: true,
  locale,
  fallbackLocale: false,
  depth: 2,
  context: { contentSourceMap: true },
  overrideAccess: false,
  req,
})
```

For localized hosts, pass a configured locale consistently to reads and `documentInfo`. Draft loaders must bypass public caches for authenticated previews. Public rendering must omit source maps, editable attributes and editor components. Host hooks and publication policies still apply to saves and publishes; the plugin does not decide when a published document appears on the storefront.

## Mount the workspace

Mount `VisualEditorWorkspace` alongside the host's rendered page only in authenticated previews. It is not a children wrapper: the shell loads the same route in a same-origin iframe, where the workspace mounts its canvas toolbar. Keep client callbacks such as `previewURL` and `preparePreview` in a client component.

```tsx
'use client'

import { VisualEditorWorkspace } from '@oak-digital/payload-visual-editor/client'

export function PreviewEditor({ id, locale }: { id: string; locale: string }) {
  return (
    <VisualEditorWorkspace
      documentInfo={{ id, collection: 'pages', hasDrafts: true, locale }}
      sources={[
        {
          slug: 'pages',
          label: 'Pages',
          titleField: 'title',
          createLabel: 'New page',
          previewURL: (document) => `/${String(document.slug ?? '')}`,
        },
      ]}
    />
  )
}
```

Adapt that example's URL resolver to the host's actual locale and preview routes. The host must keep the iframe authenticated and same-origin.

| Workspace prop                               | Purpose                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `documentInfo`                               | `{ id, collection, hasDrafts, locale? }` for the current page. IDs can be strings or numbers.                                         |
| `sources`                                    | Navigation sources with `slug`, `label`, optional `titleField`, `previewURL`, `createLabel`, `pageSettings`, `global` and `editable`.                 |
| `adminRoute`, `apiRoute`                     | Host routes; default to `/admin` and `/api`.                                                                                          |
| `preparePreview`                             | Async `(signal: AbortSignal) => Promise<void>` callback to renew the authenticated preview session before refresh. Reject on failure. |
| `annotationTickets`                          | Enables the built-in annotation client; requires server annotation configuration.                                                     |
| `submitAnnotation`, `deleteAnnotationTicket` | Custom ticket callbacks; see [annotation setup](README.annotations.md).                                                               |

Sources without preview URLs or shared editing open native Payload editors in a new tab. `createLabel` adds a collection creation link with the current locale. Globals marked only with `global: true` open their native editor; add `editable: true` and server `sharedContent` configuration to edit them in the workspace.

For a standalone toolbar, mount `VisualEditorToolbar` from `/client` with `documentInfo` and optional `adminRoute`/`apiRoute`. Do not mount it a second time alongside the workspace. The standalone toolbar also retains older inline text/image and rich-text modal flows; see the feature guides for their different persistence behavior.

Hosts using expiring draft sessions should provide `preparePreview`. Refresh failures retain the saved outcome and expose a refresh-only retry; concurrent refresh requests share one operation. Restart the host after endpoint or plugin configuration changes.

## Bind shared renderers

For a host block with a heading and populated image, bind the loaded page before rendering:

```tsx
import {
  bindSourceMap,
  editableField,
  editableValue,
} from '@oak-digital/payload-visual-editor/utilities'

const owner = { id: page.id, collection: 'pages', locale, hasDrafts: true }
const content = bindSourceMap(page, page._sourceMap, owner)
const preview = (
  <>
    <h2 {...editableField(content.layout[0], 'heading')}>{content.layout[0].heading}</h2>
    <img {...editableValue(content.layout[0].image)} src={content.layout[0].image.url} alt="" />
  </>
)
```

Bind before filtering or transforming rows. Every occurrence keeps its original field path, even when several fields reference the same media record. Shared image and rich-text renderers can spread `editableValue(resource)`; scalar text uses `editableField(parent, fieldName)`. For a displayed fallback image, spread `editableField(slide, 'imageOverride')` explicitly so replacement creates the override. Optional scalar fields are writable only when the server schema resolves their existing parent.

Bindings include the owning document and locale. The toolbar groups pending changes by owner, and image previews distinguish identical paths in different documents. Saving several documents is sequential, not atomic; an error reports that earlier documents may already have saved. Only bind referenced documents whose collections are enabled and support drafts. Never attach a parent page's path to unrelated content.

Without a source map, binding leaves content unchanged. Unmapped preview selections explain that they cannot be edited here. Hardcoded copy, calculated commerce values and unbound shared content require host integration; the editor never guesses ownership from text or an image URL.

## Mark block lists

For canvas block selection and rearrangement, mark the list with its owning blocks path and document, and mark each direct child with its stable Payload row ID:

```tsx
<section data-payload-block-list="layout" data-payload-document={JSON.stringify(owner)}>
  {content.layout.map((block) => (
    <div key={block.id} data-payload-block-id={block.id}>
      {/* Render the host's block component with its bound field values. */}
    </div>
  ))}
</section>
```

Render all rows in source order. Use a column flex/grid layout for the plugin's pending-order preview. Bind before filtering or transforming rows, and omit these wrappers/attributes from public rendering. The plugin never derives ownership from matching text, media IDs or URLs.

Relationship-backed arrays can opt into add/remove/reorder controls with `custom: { visualEditorRelationship: 'product' }` on the array field. The value names a direct, single-value, single-collection relationship field in each row. Choices and updates enforce the relationship's access and filters. Ordinary arrays and nested blocks also support add, duplicate, remove and reorder through their schema controls, with row limits and field access enforced.

## Host-rendered pending content

Wrap the host's rendered blocks with `data-payload-live-preview`. The canvas dispatches `payload:render-preview` events with `{ owner, request }`; a null request resets the saved rendering. Send the request to the arrange endpoint with `action: 'preview'` through an authenticated host rendering boundary. The endpoint applies the same access, revision and schema checks as saving, returns populated `document`, `sourceMap` and original `rowPaths`, and does not write documents or versions.

Render the returned document with the host's actual block components. Pass `rowPaths` to `bindSourceMap` so moved rows retain their original editing paths; remap explicit field attributes similarly. Debounce requests, ignore stale responses, preserve the last successful preview on failure, and dispatch `payload:preview-rendered` after committing the result so canvas bindings refresh. The host owns block/media DOM while this bridge is present. Without it, the plugin uses its neutral draft cards and immediate DOM previews.

## Reusable layouts

Opt a single relationship into layout editing with `custom: { visualEditorLayout: 'layout' }`, where the value is the source's blocks path. Enable both collections in the plugin and enable native drafts on the source. Bind rendered source blocks to their actual owner and source map; never reuse the parent page's ownership. The host preview boundary must render both collection types and dispatch `payload:preview-request` when a source boundary mounts so pending sessions can be replayed.

The selected reference offers source selection, **Edit shared layout**, and **Make independent**. Shared blocks use a separate drawer view with access-filtered draft/published usage information. Independent copies resolve source data on the server, reject stale revisions and inaccessible sources, project onto destination fields, and generate fresh row IDs. Pending source field/array edits are carried into the page copy. Both paths retain normal save, undo and recovery behavior. Layout preparation never writes documents.

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

The workspace reads Payload field schemas for text, textarea, email, numbers, checkboxes, select/radio (including multiple selection), single relationships, groups, arrays and blocks. Arrays use schema limits and stable row IDs. Conditional fields and field permissions are evaluated on the server. Rich text and uploads are not controls in this separate shared-content editor. Unsupported fields remain in Payload; updates preserve other document fields. Relationship pickers search accessible documents with pagination; enabled related content opens another retained editor session.

Shared edits have their own persistent footer and undo/redo history. Save draft saves dirty shared documents; Review & publish reviews and publishes the full drafts of the listed shared documents. Page edits remain separate. Saves are transactional per document; if a later document fails, earlier successful saves remain saved and remaining edits stay available. Revision checks reject stale edits. A database with transaction support is required. Sources without drafts expose publication only.

Host renderers subscribe with `useSharedContentPreview` from `@oak-digital/payload-visual-editor/preview`. It returns an array of the latest `{ target, document, focusPath }` entries received from the same-origin parent workspace, one per target. Documents include accessible populated relationships; the host chooses how to render them and reveal the selected region. No REC schema or storefront styling is built into the plugin. The standalone preview export avoids pulling editor controls into public storefront bundles. Shared-content persistence uses `<api route>/payload-visual-editor/shared-content` with Payload access checks, validation and hooks.

Draft loaders in each host must bypass public caches only for authenticated preview sessions. Collections that previously saved immediately need their existing development content initialized with the intended publication status when enabling drafts. No legacy schema fallback is provided.

## Historical rendering

The revisions endpoint authorizes historical reads and creates a selected-locale draft on restoration, guarded by the current version fingerprint and a transaction. Restoration never invokes native all-locale restoration and does not publish.

Handle `payload:render-revision` with `{ owner, versionId }` (`versionId: null` returns to the saved rendering). Render historical blocks without editing bindings, then dispatch `payload:revision-result` with `{ owner, versionId, revision }` or `{ owner, versionId, error }`. Linked content remains at current saved values. Preserve pending edits during preview; they must be saved or discarded before restoration.

## Endpoint reference

Paths below are relative to the configured Payload API route (normally `/api`). They require authentication and enforce their configured collection/shared-content scope, document/field access and locales. User-facing Local API operations pass the authenticated request and `overrideAccess: false`.

| Method        | Path                                    | Responsibility                                                                |
| ------------- | --------------------------------------- | ----------------------------------------------------------------------------- |
| POST          | `/payload-visual-editor/workspace`      | Read offered locales and public availability by document identity.           |
| POST          | `/payload-visual-editor/arrange`        | Field/block preparation, pending preview, review, draft save and publication. |
| POST          | `/payload-visual-editor/shared-content` | Opted-in collections/globals, choices, review and persistence.                |
| POST          | `/payload-visual-editor/rich-text`      | Native Lexical editor context, validation and standalone persistence.         |
| POST          | `/payload-visual-editor/media`          | Access-filtered image choices and upload context.                             |
| POST          | `/payload-visual-editor/revisions`      | Historical reads and guarded draft restoration.                               |
| POST          | `/payload-visual-editor`                | Legacy standalone text/image patch saves and publication.                     |
| POST / DELETE | `/payload-visual-editor/annotations`    | Optional Oak OS ticket submission/deletion.                                   |
| POST          | `/payload-visual-editor/connection`     | Optional Oak OS connection test.                                              |

`review`, `preview` and field preparation do not write documents or versions. Arrange/shared-content saves are transactional per document and sequential across documents. The legacy text/image patch endpoint does not provide the arrange flow's revision and transaction protections. Native media creation is a separate immediate write.
