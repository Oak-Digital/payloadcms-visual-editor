# Rich-text editing

[Back to README](README.md) · [Editor guide](README.editing.md) · [Host integration](README.integration.md)

## Workspace editing

In **Edit content**, selecting rich text on the canvas opens its configured Lexical editor over the selected content. The overlay fits the website preview viewport and uses the field’s configured toolbar. The surrounding editor is desktop-only; mobile preview width tests the website layout. Hovering or focusing a marked field warms its editor; the last canvas editor stays mounted after Confirm so reopening avoids another load. Warmup never stages changes. Native link and embedded-content drawers expand the panel; close or apply the drawer before confirming the field. **Confirm** (or Escape) closes it and retains the pending edits. Selecting a rich-text field from the sidebar opens its editor there. Edits queue automatically and remain when switching fields or sidebar size. **Save draft** saves the pending batch.

## Legacy standalone modal

In the standalone toolbar’s inline editing mode, click a marked rich-text field to open its native Payload Lexical editor in a modal. Formatting controls, link drawers, custom features and embedded-content editors come from that field's host configuration. **Save draft** and **Publish** use the host's normal Payload update operation, access rules, validation and hooks. Publishing publishes the whole document, including its existing draft changes. Close the editor to refresh the preview after saving. This modal has its own save/publish actions; its unsaved content is not part of workspace recovery and is lost on browser reload.

## Integration

The plugin registers an authenticated admin view at `<admin route>/visual-rich-text` and a POST endpoint at `<api route>/payload-visual-editor/rich-text`. Regenerate the host import map after installation. Hosts must supply the same Payload UI, Lexical, Next and React instances as their admin application; these are peer dependencies.

`buildSourceMap` represents rich-text fields with `{ type: 'richText' }`. Spread `createEditableAttrs(sourceMap, owner)('layout.0.richText')` on the container rendering exactly that field. The attributes include `data-payload-type="richText"`. The workspace and toolbar accept `adminRoute` and `apiRoute` for hosts using custom routes. Mount editor controls only in authenticated draft previews.

The editor resolves instance paths into Payload schema paths, including nested arrays, groups, blocks and unnamed tabs/rows. It uses `RenderLexical`, so REC-specific features remain in REC. Supported nodes are the nodes configured on the target field, not a separate plugin feature list. The test suite exercises formatted text, styles, headings, links, lists and a host-defined embedded node. REC's Paragraph block is the representative integration; its configured features determine the controls shown.

## Data safety

- Rich text is always Lexical JSON. It never goes through the plain-text patch or annotation pipeline.
- Empty roots open with a blank paragraph in the editor. Opening or resetting the field does not stage a change; existing content and formatting are preserved.
- Before loading or saving, the server imports and exports through the host's node classes. Unknown nodes, incompatible node versions and custom properties that would be lost cause an explicit error. Paragraph cursor-format metadata may be recalculated by Lexical; child text formatting is preserved.
- Reads and writes enforce collection and ancestor/field access. Protected rich-text subfields that would produce an incomplete editable value block saving. Localized hosts must supply a configured locale; fallback is disabled.
- Standalone rich-text updates copy complete sibling data and replace only the selected rich-text value; workspace saves include the other reviewed pending operations. Native Payload handles localization, draft validation policy and publication validation.
- A revision hash covers the latest complete version, including other fields/locales. A stale revision is rejected. Transactions lock and restore the base version's `latest` flag before the normal update, preventing concurrent visual-editor or admin writes from silently winning. The intermediate flag is never committed or externally visible.
- Failed saves retain pending values and show errors. Closing a modified standalone modal asks before discarding unsaved changes. Closing the workspace overlay retains pending values. Content changes are not stored as feedback annotations or sent to annotation webhooks.

## Limits

Requires native drafts, existing saved versions and a transaction-capable adapter. MongoDB must run as a replica set. Concurrency is integration-tested against REC's MongoDB adapter; other adapters need equivalent integration verification before deployment. Payload's `RenderLexical` API is experimental, and this fork pins Payload 3.79.0.

Canvas selection requires a marked rich-text field on an enabled collection. Schema-driven block forms also expose empty rich-text fields. Referenced documents and reusable layouts can be edited when enabled and bound to their actual owning collection/document; they must not inherit the parent page's paths. The separate shared-content editor for globals/collection roots does not provide rich-text controls. `blockReferences` schemas are not supported by this integration.

Supported edits run through the canvas overlay, sidebar or standalone modal, not a `contenteditable` storefront element. Workspace rich-text edits participate in the same pending values, undo/redo, recovery and revision-checked save flow as text and images. A host pending-preview bridge can render those edits before saving; without it, typing does not live-render the rich-text storefront. Unsupported content must be edited in the full admin; there is no lossy conversion fallback.

## Verification

For a standalone clone, run `pnpm test:unit` and `pnpm build`. The build already checks TypeScript.

From REC's `frontend/` Nix shell, inspect the affected runner and use the host verification workflow:

```sh
pnpm verify:visual-editor editing --runner rich-text --plan
pnpm verify:visual-editor editing --runner rich-text --integration
```

Add `persistence` or `host` profiles and affected runners when changing those boundaries. The runner lives at `frontend/apps/web/src/lib/visual-editor/rich-text.integration.ts` in REC. It needs the local database and dev server and creates disposable content. Check the desktop editor with desktop and mobile website preview widths, configured formatting/link/embed controls, pending edits across field navigation, undo/redo, draft isolation and publication. Failure coverage includes denied access, stale revisions, unsupported nodes and transaction rollback. See [development and verification](CONTRIBUTING.md).
