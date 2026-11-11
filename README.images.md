# Image selection and replacement

[Back to README](README.md) · [Editor guide](README.editing.md) · [Host integration](README.integration.md)

In the workspace's **Edit content** mode, select a marked image on the canvas or its field in the sidebar. Search filenames, browse pages, select a thumbnail and choose **Use image**. The replacement remains pending alongside text, rich-text and block edits, with shared undo/redo and recovery. **Save draft** persists it; **Publish all** opens review before publication. Existing media files are never overwritten.

The standalone toolbar's older inline mode keeps replacements as local edit annotations. There, **Save** stores a draft and **Publish** publishes through Payload validation/hooks; clearing the edit restores the original preview. Feedback comments never become CMS mutations. This legacy text/image path does not have the workspace arrange flow's revision/transaction checks.

## Native upload

**Upload a new image** opens the host's native Payload creation form inside the picker when collection create access permits it. Save the media item there, then choose **Return to images** and select it. This preserves the host's required metadata, upload limits, MIME validation, access rules and hooks. Uploading creates a media item immediately; cancelling the picker does not delete that item. Only images matching the target field's filter are selectable.

## Host integration

Use `createEditableAttrs(document._sourceMap, owner)('layout.0.image')` on the exact `img` element, forwarding the returned attributes through custom image components. Alternatively, bind the document with `bindSourceMap` and spread `editableValue(image)` or `editableField(block, 'image')`. Source maps contain upload descriptors as well as text values. Resolve paths from the owning document, never from image URLs or media IDs: the same media can be used in multiple fields.

For responsive `picture` elements, mark each `source` with its own upload field path and mark the fallback `img` separately. Clicking the image selects the matching media-query source. A host overlay can carry the desktop attributes plus `data-payload-mobile-path` for a mobile field at the 767px breakpoint; this is used by REC's cinematic hero. Prefer marking actual images where possible.

The workspace and toolbar accept `apiRoute` and `adminRoute` for non-default Payload routes. Mount editor controls only in authenticated previews; provide the document collection, ID and configured locale. The media endpoint resolves the upload collection from the server schema and uses the authenticated request for every query.

## Supported fields and restrictions

- Single-collection, single-value upload fields inside groups, named/unnamed tabs, arrays and blocks.
- String and numeric media IDs; populated media source maps preserve the upload field's ownership.
- Image-only choices, collection MIME restrictions, static and dynamic `filterOptions`, collection read/update access, ancestor/field read/update access, and required-field checks before saving or publishing.
- Responsive `srcset`/`sizes` and focal positions are restored when a pending preview is cleared. Source assets, other field usages and other locales are preserved.

Many-value and polymorphic uploads, rich-text embedded images, CSS backgrounds, unmarked images, virtual/read-only fields and structural changes are not supported by this image picker. Mark additional renderers explicitly; do not guess paths for referenced documents. This feature does not add image generation or image manipulation.

## Verification

Run `pnpm test:unit` and `pnpm build` in a standalone clone; a separate typecheck is unnecessary after the build.

From REC's `frontend/` Nix shell:

```sh
pnpm verify:visual-editor editing --runner media --plan
pnpm verify:visual-editor editing --runner media --integration
```

Add profiles/runners for other affected boundaries. Inspect REC's `frontend/apps/web/src/lib/visual-editor/media.integration.ts` before execution; it requires the local database and running storefront and creates disposable user/page/media records. Check picker access, keyboard selection, native upload UI, pending previews, draft/public isolation and publishing in a desktop editor at both website preview widths. See [development and verification](CONTRIBUTING.md).
