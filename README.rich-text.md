# Rich-text editing

In **Edit content**, selecting rich text on the canvas opens its configured Lexical editor over the selected content. The compact overlay fits the viewport, including mobile screens, and uses the field’s configured toolbar. Hovering or focusing a marked field warms its editor; the last canvas editor stays mounted after Confirm so reopening avoids another load. Warmup never stages changes. Native link and embedded-content drawers expand the panel; close or apply the drawer before confirming the field. **Confirm** (or Escape) closes it and retains the pending edits. Selecting a rich-text field from the sidebar opens its editor there. Edits queue automatically and remain when switching fields or sidebar size. **Save draft** saves the pending batch.

In inline editing mode, click a marked rich-text field to open its native Payload Lexical editor in a modal. Formatting controls, link drawers, custom features and embedded-content editors come from that field's host configuration. **Save draft** and **Publish** use the host's normal Payload update operation, access rules, validation and hooks. Publishing publishes the whole document, including its existing draft changes. Close the editor to refresh the preview after saving.

## Integration

The plugin registers an authenticated admin view at `<admin route>/visual-rich-text` and a POST endpoint at `<api route>/payload-visual-editor/rich-text`. Regenerate the host import map after installation. Hosts must supply the same Payload UI, Lexical, Next and React instances as their admin application; these are peer dependencies.

`buildSourceMap` represents rich-text fields with `{ type: 'richText' }`. Spread `createEditableAttrs(sourceMap)('layout.0.richText')` on the container rendering exactly that field. The attributes include `data-payload-type="richText"`. The toolbar accepts `adminRoute` and `apiRoute` for hosts using custom routes. Mount it only in authenticated draft previews.

The editor resolves instance paths into Payload schema paths, including nested arrays, groups, blocks and unnamed tabs/rows. It uses `RenderLexical`, so REC-specific features remain in REC. Supported nodes are the nodes configured on the target field, not a separate plugin feature list. The test suite exercises formatted text, styles, headings, links, lists and a host-defined embedded node. REC's Paragraph block is the representative integration; its configured features determine the controls shown.

## Data safety

- Rich text is always Lexical JSON. It never goes through the plain-text patch or annotation pipeline.
- Empty roots open with a blank paragraph in the editor. Opening or resetting the field does not stage a change; existing content and formatting are preserved.
- Before loading or saving, the server imports and exports through the host's node classes. Unknown nodes, incompatible node versions and custom properties that would be lost cause an explicit error. Paragraph cursor-format metadata may be recalculated by Lexical; child text formatting is preserved.
- Reads and writes enforce collection and ancestor/field access. Protected rich-text subfields that would produce an incomplete editable value block saving. Requests require a configured locale with fallback disabled.
- Updates copy complete sibling data and replace only the selected rich-text value. Native Payload handles localization, draft validation policy and publication validation.
- A revision hash covers the latest complete version, including other fields/locales. A stale revision is rejected. Transactions lock and restore the base version's `latest` flag before the normal update, preventing concurrent visual-editor or admin writes from silently winning. The intermediate flag is never committed or externally visible.
- Unknown content and failed saves remain in the editor; errors are visible. Closing a modified editor asks before discarding unsaved changes. Content changes are not stored as feedback annotations or sent to annotation webhooks.

## Limits

Requires native drafts, existing saved versions and a transaction-capable adapter. MongoDB must run as a replica set. Concurrency is integration-tested against REC's MongoDB adapter; other adapters need equivalent integration verification before deployment. Payload's `RenderLexical` API is experimental, and this fork pins Payload 3.79.0.

Only populated, marked rich-text fields on enabled collections are editable. Globals, externally referenced documents/Saved Layouts and `blockReferences` schemas are not wired by this integration. Unsupported content must be edited in the full admin; there is no lossy conversion fallback. Edits are made in the canvas overlay, sidebar or inline-editing modal, not directly in the page's DOM. Closing after saving refreshes the preview; typing does not live-render the storefront. Unsaved changes are local to the open editor and are lost on a browser refresh. Plain-text/media editing retain their existing save flow and do not gain rich-text revision checks.

## Verification

From REC's `frontend/` Nix shell:

```sh
pnpm --filter @oak-digital/payload-visual-editor test:unit
pnpm --filter web test:payload-dependencies
pnpm --filter web payload run src/lib/visual-editor/rich-text.integration.ts
pnpm typecheck
pnpm build
```

The integration runner requires the local `rec-watches` database and the dev server. It creates and cleans up its own page/user, exercises the actual editor at 1440px and 390px, changes formatting, checks links/siblings/other locales, draft isolation, publishing, validation, stale edits, unsupported nodes and two concurrent writers. Screenshots are written to `/tmp/rec-rich-text-*.png`. Unit tests also cover denied collection/field access, nested paths, list/embed round trips and transaction rollback.
