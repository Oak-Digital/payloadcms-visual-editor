import { createHash } from 'node:crypto'
import type { CollectionSlug, PayloadHandler, PayloadRequest, TypedLocale } from 'payload'
import type { AnnotationTicketRequest } from '../types.js'
import { defaultSettingsAccess, type AnnotationSettingsAccess } from './config.js'
import {
  decryptApiKey,
  getAnnotationIntegration,
  getOakConnectionOptions,
  readAnnotationSettings,
} from './settings.js'

const headers = { 'Cache-Control': 'no-store' }
const fail = (error: string, status: number) => Response.json({ error }, { status, headers })
const identifierPattern = /^[A-Z0-9]+-\d+$/
const noContent = () => new Response(null, { status: 204, headers })
function authenticated(req: PayloadRequest) {
  return Boolean(req.user && req.user.collection === req.payload.config.admin.user)
}
function sameOrigin(req: PayloadRequest) {
  return Boolean(req.url && req.headers.get('origin') === new URL(req.url).origin)
}
function validAnnotation(
  input: unknown,
): input is AnnotationTicketRequest & { identifier?: string } {
  if (!input || typeof input !== 'object') return false
  const data = input as AnnotationTicketRequest
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
  return (
    Number.isInteger(data.createdAt) &&
    data.createdAt > 0 &&
    text(data.id, 36) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.id) &&
    text(data.comment, 10000) &&
    Boolean(data.comment.trim()) &&
    text(data.element, 500) &&
    text(data.elementPath, 2000) &&
    text(data.url, 2000) &&
    Boolean(
      data.document &&
        text(data.document.collection, 100) &&
        ['string', 'number'].includes(typeof data.document.id) &&
        String(data.document.id).length > 0 &&
        String(data.document.id).length <= 100 &&
        (data.document.locale === undefined || text(data.document.locale, 100)),
    ) &&
    Number.isFinite(data.x) &&
    data.x >= 0 &&
    data.x <= 100 &&
    Number.isFinite(data.y) &&
    data.y >= 0
  )
}

export const createAnnotationHandler =
  (enabled: Partial<Record<CollectionSlug, true>>, action: 'submit' | 'delete'): PayloadHandler =>
  async (req) => {
    if (!sameOrigin(req)) return fail('Invalid origin.', 403)
    if (!authenticated(req)) return fail('Sign in to Payload again, then retry.', 403)
    let input: unknown
    try {
      input = await req.json?.()
    } catch {
      return fail('Invalid annotation.', 400)
    }
    if (JSON.stringify(input)?.length > 20000) return fail('Annotation is too large.', 413)
    if (!validAnnotation(input)) return fail('Invalid annotation.', 400)
    if (!enabled[input.document.collection as CollectionSlug])
      return fail('Collection is not enabled.', 403)
    let pageURL: URL
    try {
      pageURL = new URL(input.url)
    } catch {
      return fail('Invalid page URL.', 400)
    }
    if (pageURL.origin !== new URL(req.url!).origin) return fail('Invalid page URL.', 400)
    pageURL.search = ''
    pageURL.hash = ''
    const locale = input.document.locale
    if (
      req.payload.config.localization &&
      !req.payload.config.localization.localeCodes.includes(locale || '')
    )
      return fail('Invalid locale.', 400)
    try {
      await req.payload.findByID({
        collection: input.document.collection as CollectionSlug,
        id: input.document.id,
        locale: locale as TypedLocale,
        draft: true,
        depth: 0,
        req,
        overrideAccess: false,
      })
    } catch {
      return fail('This document is unavailable.', 403)
    }
    let integration: Awaited<ReturnType<typeof getAnnotationIntegration>>
    try {
      integration = await getAnnotationIntegration(req.payload)
    } catch {
      return fail('Annotation settings are unavailable. Try again.', 503)
    }
    if (!integration) return fail('Annotation tickets are disabled or not configured.', 503)
    const { key, projectId, bugLabelId } = integration
    const authHeaders = { Authorization: `Bearer ${key}` }
    const documentLine = `Document: ${input.document.collection}/${input.document.id} (${locale || 'default'})`
    try {
      if (action === 'delete') {
        if (!input.identifier || !identifierPattern.test(input.identifier))
          return fail('Invalid ticket.', 400)
        const current = await fetch(`https://os.oak.dk/api/v1/tasks/${input.identifier}`, {
          headers: authHeaders,
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
        })
        if (current.status === 404) return noContent()
        if (!current.ok) return fail('Unable to check the Oak OS ticket. Try again.', 502)
        const { data: task } = await current.json()
        if (
          task?.project?.id !== projectId ||
          task.identifier !== input.identifier ||
          typeof task.description !== 'string' ||
          !task.description.endsWith(`\nAnnotation: ${input.id}`) ||
          !task.description.includes(`\n${documentLine}\n`)
        )
          return fail('This ticket does not match the annotation.', 403)
        const version = current.headers.get('etag')
        if (!version || typeof task.id !== 'string')
          return fail('Unable to check the ticket version. Try again.', 502)
        const deleted = await fetch(
          `https://os.oak.dk/api/v1/tasks/${encodeURIComponent(task.id)}`,
          {
            method: 'DELETE',
            headers: { ...authHeaders, 'If-Match': version },
            signal: AbortSignal.timeout(15000),
          },
        )
        if (deleted.status === 412)
          return fail('The ticket changed. Review it before trying again.', 409)
        if (!deleted.ok && deleted.status !== 404)
          return fail('Oak OS could not delete this ticket. Try again.', 502)
        return noContent()
      }
      // Oak OS idempotency records expire after 24 hours.
      if (
        input.createdAt > Date.now() + 60000 ||
        Date.now() - input.createdAt > 23 * 60 * 60 * 1000
      )
        return fail('This submission has expired. Check Oak OS before adding a new note.', 409)
      const idempotencyKey = createHash('sha256')
        .update(`${projectId}:${req.user!.id}:${input.id}`)
        .digest('hex')
      const description = [
        input.comment.trim(),
        '',
        `Page: ${pageURL.href}`,
        documentLine,
        `Element: ${input.element}`,
        `Selector: ${input.elementPath}`,
        `Position: ${input.x}% across, ${input.y}px down`,
        `Annotation: ${input.id}`,
      ].join('\n')
      const response = await fetch('https://os.oak.dk/api/v1/tasks', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          projectId,
          labelIds: [bugLabelId],
          title: input.comment.trim().replace(/\s+/g, ' ').slice(0, 160),
          description,
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) return fail('Oak OS could not accept this note. Retry submission.', 502)
      const result = await response.json()
      const identifier = result.data?.identifier
      if (typeof identifier !== 'string' || !identifierPattern.test(identifier))
        throw new Error('Invalid ticket response')
      return Response.json({ identifier, url: `https://os.oak.dk/task/${identifier}` }, { headers })
    } catch {
      return fail(
        action === 'delete'
          ? 'Oak OS did not confirm deletion. Try again to check.'
          : 'Oak OS did not confirm submission. Retry to check the same request.',
        502,
      )
    }
  }

export const createAnnotationConnectionHandler =
  (access: AnnotationSettingsAccess = defaultSettingsAccess): PayloadHandler =>
  async (req) => {
    if (!sameOrigin(req)) return fail('Invalid origin.', 403)
    if (!authenticated(req) || !(await access({ req })))
      return fail('Sign in to Payload as an admin.', 403)
    let input: unknown
    try {
      input = await req.json?.()
    } catch {
      return fail('Invalid request.', 400)
    }
    if (
      !input ||
      typeof input !== 'object' ||
      !('apiKey' in input) ||
      typeof input.apiKey !== 'string' ||
      input.apiKey.length > 500
    )
      return fail('Invalid API key.', 400)
    try {
      let key = input.apiKey.trim()
      if (!key) {
        const settings = await readAnnotationSettings(req.payload)
        if (!settings.encryptedApiKey) return fail('Enter an API key first.', 400)
        key = decryptApiKey(settings.encryptedApiKey, req.payload.secret)
      }
      return Response.json(await getOakConnectionOptions(key), { headers })
    } catch {
      return fail('Connection failed. Check the API key and its project permissions.', 502)
    }
  }
