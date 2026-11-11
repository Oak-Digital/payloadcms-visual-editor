# Using the editor

[Back to README](README.md) · [Host integration](README.integration.md)

This guide describes the Oak workspace. The standalone toolbar also retains older inline editing modes; their differences are documented in the [rich-text](README.rich-text.md) and [image](README.images.md) guides.

## Open and navigate

Open an authenticated draft preview and expand the Oak dot, or press **E**. The workspace contains content navigation, editing modes, page blocks, annotations, shared content, preview widths and revisions. **Escape** goes back a layer, then collapses the panel. Closing a drawer, changing its width or collapsing the workspace retains pending edits.

Use **Desktop** and **Mobile** to change the website iframe width. The editor itself is desktop-only. Settings control Standard/Large sidebar size, reduced motion and placement in any of the four corners. Drag or throw the collapsed dot to reposition it; the chosen corner is remembered in this browser.

Content search opens configured preview routes. Sources without preview URLs open their native Payload editor. An optional **New page** action opens native creation in a new tab with the current locale.

Switching pages with pending changes offers **Save and switch**, **Keep editing** and **Discard and switch**. Saving waits for page and shared-content saves; failure keeps the current page open. Discard clears the affected recovery records. Navigation is blocked while saving.

## Edit content

In **Edit content**, select a marked field on the canvas or choose a block to open its controls. Keyboard users can focus a marked field and press Enter. Unmapped selections explain that they cannot be edited here; the editor does not infer ownership from matching text or image URLs.

Text and textarea values can be edited directly on the canvas. Rich text opens the field's configured Lexical editor over the selected content; sidebar selections open it in the sidebar. **Confirm** or Escape closes the rich-text overlay with edits retained. Image selections also remain pending. Canvas and sidebar controls share pending values, undo/redo and saving.

Block forms follow the host schema, including groups, rows, tabs, scalar controls, single relationships and link fields. Rich text, media and shared-layout selection open layered views with a Back action. Array/nested-block items open their own fields. Field conditions are evaluated on the server against pending values; hiding a field retains its edits. Unsupported fields remain available through native Payload editing.

## Arrange blocks

The Blocks list starts in Edit mode. Selecting a block reveals its controls and scrolls its section into view. **Add block** opens the allowed block picker for that list. With a block selected, **Duplicate block** and **Remove block** appear in the contextual actions. Schema row limits and allowed types still apply.

Added blocks receive stable row IDs and can be edited before saving. Without a host pending-preview renderer, they appear as neutral draft cards with starter text and image placeholders; those placeholders are never saved as media. A duplicate carries pending field edits, regenerates nested row IDs and retains media/relationship references. Removing a block hides it immediately. These operations stay pending and participate in undo/redo.

Switch to **Rearrange** for drag handles and move buttons. On the canvas, drag within a block or use its contextual controls; the handle also accepts Up/Down keys. Content selection is suspended while rearranging. Returning to Edit retains the pending order and field values.

Ordinary arrays inside block forms support editing existing items. Arrays explicitly configured with a relationship field support add/remove/reorder. Shared-content arrays have their own structural controls. See [host integration](README.integration.md#mark-block-lists) for the required bindings and schema options.

## Save and publish

**Save draft** persists pending field and block changes together, then refreshes the preview. **Publish all** opens a comparison with published content, including both pending changes and earlier saved drafts. **Publish now** publishes the reviewed locale and nonlocalized fields through the host's normal validation and hooks.

Review shows the proposed content first, with the published value in a collapsed comparison. Rich-text edits are grouped as one change; removals are explicit. Review itself does not save documents or versions. The proposed operations are frozen during review, and stale revisions are rejected at persistence.

Page/layout sessions and shared-content sessions have separate publishing scopes. Saving or publishing multiple documents is sequential, with a transaction per document. If a later document fails, successful outcomes are retained and unsaved work remains available. Refresh the review before retrying publication; successful documents are not replayed. Validation errors identify affected fields; **Edit content** returns to editing with the pending work intact.

The footer keeps save/publish actions and status visible. Details collapse after inactivity; errors, busy states and recovery notices keep them open. A refresh failure after a successful save preserves the saved outcome and offers a refresh-only retry. Retrying refresh does not repeat persistence.

## Recover pending edits

Workspace recovery is stored in this browser, scoped to the authenticated user, owning document and locale. Reopening offers **Restore edits** or **Discard stored edits**. A newer server revision blocks restoration and exposes stored changes for review. Restoring browser edits does not publish content.

Leaving or reloading warns about pending work. Storage failures keep edits in memory and ask the editor to save a draft. Explicitly discarding edits clears the corresponding recovery records. Recovery does not replace saving a draft, and the legacy standalone rich-text modal has a separate, nonrecoverable pending state.

## Shared content and layouts

Opted-in shared collections and globals open in a retained editor session with their own footer and undo/redo. **Save draft** saves dirty shared documents; **Publish all** reviews the full drafts of the listed shared documents. Sources without drafts expose publication only. Page edits remain separate.

A reusable-layout relationship offers source selection, **Edit shared layout** and **Make independent**. Editing the source changes the source document. Making it independent prepares a page-owned copy with fresh row IDs and carries over pending source edits. Preparation does not write documents; save or publish persists the copy. Usage information is filtered by access and indicates incomplete results.

## Revisions and feedback

**Revisions** lists unsaved changes and saved versions, with older history loaded on demand. Historical visual previews require the host renderer. Linked content remains at its current saved values. Save or discard pending edits before restoring a version; restoration creates a draft for the selected locale and does not publish it.

Comments create feedback notes, separate from CMS field edits. Notes and ticket links are tracked in this browser. See [annotation tickets](README.annotations.md) for screenshots, local archive/restore, external deletion and retries.
