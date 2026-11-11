# Annotation tickets

[Back to README](README.md) · [Editor guide](README.editing.md)

## Configure Oak OS

Enable the reusable Oak OS integration on any Payload host:

```ts
import { payloadVisualEditor } from '@oak-digital/payload-visual-editor'

payloadVisualEditor({ collections: { pages: true }, annotations: true })
```

Pass `annotationTickets` to `VisualEditorWorkspace`. The plugin registers **Tools & Settings → Visual Editor**, plus POST/DELETE `/payload-visual-editor/annotations` and POST `/payload-visual-editor/connection` beneath the host’s Payload API route. Regenerate the host’s types/import map and restart its server after enabling the feature.

In the Global, enter the site’s project API key, choose **Test connection**, select its project and Bug label, enable annotation tickets, and save. Blank key input preserves the saved key; Remove saved key requires disabling tickets first. Keys are encrypted using the host’s Payload secret and never returned through the public/admin API. Keep the Payload secret stable; changing it requires re-entering the key. Configuration and credentials belong to each site’s database, with no environment-variable fallback or REC-specific IDs.

By default, settings access is limited to accounts in the host’s configured admin auth collection. Hosts with roles can supply their own `annotations.settingsAccess` callback to restrict settings to authorized administrators. The same policy protects Test connection. Annotation endpoints require the host’s admin auth collection, an enabled document collection, a configured locale when localization is enabled and document read access. The saved project and annotation identity are checked before deleting a ticket, with its current ETag.

## Notes and retries

The editor retains notes, positions, ticket links and immutable requests in browser storage. Resolve archives a note locally; Archived offers Restore. Delete ticket removes the external ticket and then the local note; failures preserve the note for retry. Retries use the original request and a stable idempotency key. Submissions older than 23 hours require checking Oak OS first because its idempotency records expire after 24 hours. This is browser-local tracking, not shared annotation storage or ticket-status synchronization.

## Screenshots

After Add note, choose Screenshot area and drag a rectangle containing the marked point, or Screenshot page to capture the full page. Back preserves the note text. The blue marker is drawn into the saved image. Capture must succeed before ticket submission. New notes capture a JPEG (up to 1920 pixels per side), excluding editor controls and form values. Cross-origin assets require CORS; video, WebGL and unsupported CSS may not reproduce exactly. Screenshots stay in browser IndexedDB so retries reuse the original bytes, including after reload.

The server creates the ticket, then uploads via Oak OS `POST /api/v1/tasks/{id}/images` using a separate idempotency key and the saved API key’s `tasks:write` permission. If upload is not confirmed, the ticket link stays visible with **Retry screenshot**; retry verifies ticket ownership without creating another ticket. Screenshot retries share the 23-hour submission window. Confirmed ticket deletion also removes the local screenshot. A missing local screenshot blocks retry rather than capturing a different page state. The Oak OS image-upload API must be deployed before enabling this flow.

## Ticket content

Ticket descriptions lead with the note, page title/link, locale and readable element label. React ancestry and coordinates are omitted. Document, field selector and annotation identifiers remain in a Technical details disclosure for agents and ticket ownership checks. Page titles use the collection’s `admin.useAsTitle` field (or `title` when not configured), with the page path used when the value is unavailable.

## Custom providers

Custom providers can supply `submitAnnotation(request, ticket?)` and `deleteAnnotationTicket(request, ticket)` callbacks instead of the built-in client. Submission returns `{ identifier, url }` with optional `screenshotUploaded` and `screenshotError`; the optional existing ticket supports screenshot retries. Deletion resolves only after success. The callback types are exported from `/client`. Keep credentials and authorization in the server. CMS field edits never invoke these callbacks.
