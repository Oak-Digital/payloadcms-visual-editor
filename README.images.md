# Image selection and replacement

In an authenticated draft preview, activate the toolbar and click a marked image (or focus it and press Enter/Space). Search filenames, browse pages, select a thumbnail and choose **Use image**. This previews a pending replacement. **Save** stores a draft; **Publish** publishes through Payload validation and hooks. Clearing the pending annotation restores the original preview. Existing media files are never overwritten.

**Upload a new image** opens the host's native Payload creation form inside the picker when collection create access permits it. Save the media item there, then choose **Return to images** and select it. This preserves the host's required metadata, upload limits, MIME validation, access rules and hooks. Uploading creates a media item immediately; cancelling the picker does not delete that item. Only images matching the target field's filter are selectable.

## Host integration

Use `createEditableAttrs(document._sourceMap)('layout.0.image')` on the exact `img` element, forwarding the returned attributes through custom image components. Source maps contain upload descriptors as well as text values. Resolve paths from the owning document, never from image URLs or media IDs: the same media can be used in multiple fields.

For responsive `picture` elements, mark each `source` with its own upload field path and mark the fallback `img` separately. Clicking the image selects the matching media-query source. A host overlay can carry the desktop attributes plus `data-payload-mobile-path` for a mobile field at the 767px breakpoint; this is used by REC's cinematic hero. Prefer marking actual images where possible.

The toolbar accepts `apiRoute` and `adminRoute` for non-default Payload routes. It must be mounted only in authenticated previews; provide the document collection, ID and configured locale. The media endpoint resolves the upload collection from the server schema and uses the authenticated request for every query.

## Supported fields and restrictions

- Single-collection, single-value upload fields inside groups, named/unnamed tabs, arrays and blocks.
- String and numeric media IDs; populated media source maps preserve the upload field's ownership.
- Image-only choices, collection MIME restrictions, static and dynamic `filterOptions`, collection read/update access, ancestor/field read/update access, and required-field checks before saving or publishing.
- Responsive `srcset`/`sizes` and focal positions are restored when a pending preview is cleared. Source assets, other field usages and other locales are preserved.

Many-value and polymorphic uploads, rich-text embedded images, CSS backgrounds, unmarked images, virtual/read-only fields and structural changes are not supported by this image picker. Mark additional renderers explicitly; do not guess paths for referenced documents. This feature does not add image generation or image manipulation.

## Verification

Run the plugin unit tests, typecheck and build. REC's disposable integration runner is `apps/web/src/lib/visual-editor/media.integration.ts`, run from its frontend Nix shell with `pnpm --filter web payload run src/lib/visual-editor/media.integration.ts`. It requires the local `rec-watches` database and running storefront, creates its own user/page/media, and cleans them up. It checks authenticated upload, picker access, keyboard selection, native upload UI, pending previews, draft/public isolation, publishing and desktop/mobile layouts.
