# Oak Payload Visual Editor

A desktop visual editing workspace for Payload CMS. Edit content in its website preview, arrange blocks, review drafts before publishing, manage shared content and leave visual feedback without losing the page context.

This is Oak Digital's development fork of [omaroubari/payloadcms-visual-editor](https://github.com/omaroubari/payloadcms-visual-editor), based on commit `908f6c994ffffc6f704ad5560a1db8bda6f847dc`. The package is **`@oak-digital/payload-visual-editor`**, currently private and unpublished. REC Watches is the verified integration target; the plugin remains reusable across Payload hosts.

## What it does

- Edit text, schema-driven scalar fields, native Lexical rich text and image selections from the canvas or sidebar.
- Add, duplicate, remove and rearrange blocks with shared pending values and undo/redo.
- Save drafts separately from publication; review pending changes and saved drafts against published content.
- Retain pending workspace edits across drawer navigation and offer browser recovery after reload, with stale-revision checks.
- Edit opted-in shared collections/globals and reusable layouts while preserving each document's ownership.
- Browse revisions, preview historical content through the host renderer and restore a selected locale as a draft.
- Capture annotated screenshots and optionally create Oak OS tickets or use a custom ticket provider.

The editor controls are desktop-only. Desktop/Mobile preview controls resize the website iframe so editors can check the responsive storefront.

## Documentation

| Guide                                       | Contents                                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [Host integration](README.integration.md)   | Authentication, server configuration, workspace props, source maps, block bindings, preview events, shared content and endpoints. |
| [Using the editor](README.editing.md)       | Navigation, editing, blocks, saving, publish review, recovery and revisions.                                                      |
| [Rich text](README.rich-text.md)            | Native Lexical integration, pending edits, standalone modal and supported content.                                                |
| [Images](README.images.md)                  | Media selection, native uploads, responsive image bindings and restrictions.                                                      |
| [Annotation tickets](README.annotations.md) | Oak OS settings, screenshots, retries and custom providers.                                                                       |
| [Development](CONTRIBUTING.md)              | Standalone/REC setup, watcher, verification and submodule workflow.                                                               |
| [Architecture and terminology](CONTEXT.md)  | Ownership, source maps, editing sessions and code boundaries.                                                                     |

## Requirements and package status

Use the dependency contract in [package.json](package.json):

| Dependency                                                | Declared requirement |
| --------------------------------------------------------- | -------------------- | --- | ----------------------------------------------- |
| Node.js                                                   | `>=24.0.0`           |
| pnpm                                                      | `^9                  |     | ^10`; repository package manager `pnpm@10.30.0` |
| Payload, `@payloadcms/ui`, `@payloadcms/richtext-lexical` | `3.79.0`             |
| React / React DOM                                         | `^19.2.4`            |
| Next.js                                                   | `^16.3.8`            |

Canvas-editable collections need native drafts and saved versions. Arrange, rich-text, shared-content and restoration flows require database transaction support. Keep the host's Payload UI, Lexical, Next and React runtime instances aligned.

Consume this fork as a local/workspace package; REC uses `workspace:*`. The upstream npm package and its examples describe a different feature set. The retained `dev/` app is an upstream demo, while root `pnpm dev` runs the package watcher.

## Integration overview

1. Add `payloadVisualEditor({ collections: { pages: true } })` to the host's Payload plugins and enable drafts on those collections.
2. Authenticate the host preview route. Read drafts with `context: { contentSourceMap: true }`, the authenticated `req` and `overrideAccess: false`.
3. Bind each rendered value to its owning document, locale and field path using `/utilities`. Mark block lists and stable row IDs for arrangement.
4. Mount `VisualEditorWorkspace` from `/client` only in authenticated previews, supplying `documentInfo` and navigation `sources`.
5. Connect host rendering for pending blocks, shared content and historical previews as needed. Renew expiring draft sessions with `preparePreview`.
6. Regenerate the host's Payload types/import map, restart its server and verify the affected integration flows.

See the [host integration guide](README.integration.md) for examples and the preview contract. Source-map context, draft cookies and canvas query parameters are not authorization. The host owns authentication, public-cache isolation, storefront rendering and publication policies.

## Package entry points

| Import                                         | Exports / use                                                                                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@oak-digital/payload-visual-editor`           | Server plugin `payloadVisualEditor`, `PayloadVisualEditorConfig`, `buildSourceMap`, `createEditableAttrs`, `imagePlaceholder`.                        |
| `@oak-digital/payload-visual-editor/client`    | `VisualEditorWorkspace`, `VisualEditorToolbar`, Payload admin components, `WorkspaceSource`, annotation callback types and `useSharedContentPreview`. |
| `@oak-digital/payload-visual-editor/utilities` | `bindSourceMap`, `createEditableAttrs`, `editableField`, `editableValue`, `isSourceMap` and `EditableAttrs`.                                          |
| `@oak-digital/payload-visual-editor/preview`   | Lightweight `useSharedContentPreview` for host renderers without importing editor controls.                                                           |
| `@oak-digital/payload-visual-editor/rsc`       | Reserved entry point; currently no exports.                                                                                                           |

Keep server and client imports separate. Prefer `/preview` for shared-content rendering and `/utilities` for DOM bindings.

## Develop

```sh
pnpm install --frozen-lockfile
pnpm test:unit
pnpm build
pnpm dev
```

Edit `src/`; `dist/` is generated. The build checks TypeScript as it emits declarations. See [development and verification](CONTRIBUTING.md) for REC profiles, host runners and the watcher lifecycle.

## Attribution

The upstream package declares MIT. Its original documentation and credits to Agentation and Tailark are preserved in [README.upstream.md](README.upstream.md). That file is a historical reference; use the guides above for this fork.
