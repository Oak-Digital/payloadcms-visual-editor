import type { CollectionSlug, PayloadHandler, TypedLocale } from 'payload'
import type { PayloadCMSPatch } from '../types.js'
import { buildPatchedUpdateData } from '../utils/payloodcms-patches.js'
import { uploadTargets, validateMedia } from '../utils/upload-fields.js'
import { applyPatchesToDocument } from '../utils/payloodcms-patches.js'
import { buildSourceMap } from '../utils/source-map.js'

type Mutation = {
  action: 'publish' | 'save'
  collection: CollectionSlug
  id: number | string
  locale?: string
  patches: PayloadCMSPatch[]
}

function isMutation(value: unknown): value is Mutation {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<Mutation>
  return (
    (body.action === 'save' || body.action === 'publish') &&
    typeof body.collection === 'string' &&
    (typeof body.id === 'string' || typeof body.id === 'number') &&
    (body.locale === undefined || typeof body.locale === 'string') &&
    Array.isArray(body.patches) &&
    body.patches.length > 0 &&
    body.patches.every(
      (patch) =>
        patch &&
        typeof patch.path === 'string' &&
        (patch.value === null ||
          typeof patch.value === 'string' ||
          typeof patch.value === 'number'),
    )
  )
}

export const createVisualEditorMutationHandler =
  (collections: Partial<Record<CollectionSlug, true>>): PayloadHandler =>
  async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    let body: unknown
    try {
      body = await req.json?.()
    } catch {
      return Response.json({ error: 'Invalid request body' }, { status: 400 })
    }
    if (!isMutation(body)) {
      return Response.json({ error: 'Invalid visual editor mutation' }, { status: 400 })
    }
    if (collections[body.collection] !== true) {
      return Response.json(
        { error: 'Collection is not enabled for visual editing' },
        { status: 403 },
      )
    }
    const collection = req.payload.config.collections.find(
      (entry) => entry.slug === body.collection,
    )
    const localization = req.payload.config.localization
    if (localization && (!body.locale || !localization.localeCodes.includes(body.locale))) {
      return Response.json({ error: 'A configured locale is required' }, { status: 400 })
    }
    if (!collection?.versions?.drafts) {
      return Response.json({ error: 'Visual editing requires drafts' }, { status: 400 })
    }
    try {
      if (body.locale) req.locale = body.locale as TypedLocale
      const currentDocument = await req.payload.findByID({
        id: body.id,
        collection: body.collection,
        depth: 0,
        draft: true,
        locale: body.locale as TypedLocale | undefined,
        fallbackLocale: false,
        overrideAccess: false,
        req,
      })
      const sourceMap = buildSourceMap(collection.fields, currentDocument)
      if (
        body.patches.some(
          ({ path }) =>
            !Object.hasOwn(sourceMap, path) ||
            (typeof sourceMap[path] === 'object' && sourceMap[path].type === 'richText'),
        )
      ) {
        return Response.json(
          { error: 'Only supported editable fields may be changed' },
          { status: 400 },
        )
      }
      const patched = applyPatchesToDocument(currentDocument, body.patches)
      const targets = uploadTargets(collection.fields, patched)
      for (const patch of body.patches) {
        if (typeof sourceMap[patch.path] === 'object') {
          const target = targets.get(patch.path)
          if (!target) throw new Error('Unsupported upload field')
          await validateMedia(target, patch.value, req, patched, body.id)
        } else if (typeof patch.value !== 'string') throw new Error('Text values must be strings')
      }
      const data = buildPatchedUpdateData(currentDocument, body.patches)
      await req.payload.update({
        id: body.id,
        collection: body.collection,
        data: { ...data, _status: body.action === 'publish' ? 'published' : 'draft' },
        depth: 0,
        draft: body.action === 'save',
        locale: body.locale as TypedLocale | undefined,
        overrideAccess: false,
        req,
      })
      return Response.json({ success: true })
    } catch (error) {
      req.payload.logger.error({ err: error }, 'Visual editor update failed')
      return Response.json(
        { error: 'Unable to save changes. Check your permissions and field values.' },
        { status: 400 },
      )
    }
  }
