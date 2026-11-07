import type { CollectionSlug, PayloadHandler, TypedLocale } from 'payload'
import { appendDraftBlocks } from '../utils/draft-blocks.js'
import { assertUploadAccess, mediaWhere, uploadTargets } from '../utils/upload-fields.js'

export const createMediaHandler =
  (collections: Partial<Record<CollectionSlug, true>>): PayloadHandler =>
  async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    try {
      const body = await req.json?.()
      if (
        !body ||
        typeof body.path !== 'string' ||
        !['string', 'number'].includes(typeof body.id) ||
        collections[body.collection as CollectionSlug] !== true
      )
        return Response.json({ error: 'Invalid media request' }, { status: 400 })
      const localization = req.payload.config.localization
      if (localization && !localization.localeCodes.includes(body.locale))
        throw new Error('A configured locale is required')
      req.locale = body.locale as TypedLocale
      const collection = req.payload.config.collections.find((c) => c.slug === body.collection)
      if (!collection?.versions?.drafts) throw new Error('Drafts required')
      // Query-scoped update access must also match this document, not merely return a truthy Where.
      const access = await collection.access.update({ req, id: body.id })
      if (!access) return Response.json({ error: 'Update access denied' }, { status: 403 })
      if (typeof access === 'object') {
        const allowed = await req.payload.find({
          collection: collection.slug,
          where: { and: [access, { id: { equals: body.id } }] },
          draft: true,
          depth: 0,
          limit: 1,
          overrideAccess: false,
          req,
        })
        if (!allowed.docs.length)
          return Response.json({ error: 'Update access denied' }, { status: 403 })
      }
      const doc = await req.payload.findByID({
        collection: collection.slug,
        id: body.id,
        draft: true,
        depth: 0,
        locale: body.locale,
        fallbackLocale: false,
        overrideAccess: false,
        req,
      })
      await appendDraftBlocks(collection.fields, doc, body.orders, req, collections)
      const target = uploadTargets(collection.fields, doc).get(body.path)
      if (!target) throw new Error('Unsupported upload field')
      await assertUploadAccess(target, req, doc, body.id)
      const where = await mediaWhere(target, req, doc, body.id)
      const mediaCollection = req.payload.config.collections.find(
        (c) => c.slug === target.field.relationTo,
      )!
      const search = typeof body.search === 'string' ? body.search.slice(0, 200) : ''
      const page = Number.isInteger(body.page) && body.page > 0 ? Math.min(body.page, 10000) : 1
      const results = await req.payload.find({
        collection: mediaCollection.slug,
        where: search ? { and: [where, { filename: { contains: search } }] } : where,
        page,
        limit: 20,
        sort: '-createdAt',
        depth: 0,
        locale: body.locale,
        overrideAccess: false,
        req,
      })
      const canUpload =
        target.field.admin?.allowCreate !== false &&
        (await mediaCollection.access.create({ req })) === true
      return Response.json({
        collection: mediaCollection.slug,
        canUpload,
        required: !!target.field.required,
        mimeTypes: mediaCollection.upload ? (mediaCollection.upload.mimeTypes ?? ['image/*']) : [],
        api: req.payload.config.routes.api,
        page: results.page,
        totalPages: results.totalPages,
        docs: results.docs.map((doc) => ({
          id: doc.id,
          url: doc.url,
          thumbnailURL: doc.thumbnailURL || doc.sizes?.thumbnail?.url || doc.url,
          filename: doc.filename,
          alt: typeof doc.alt === 'string' ? doc.alt : '',
          focalX: doc.focalX,
          focalY: doc.focalY,
        })),
      })
    } catch (error) {
      req.payload.logger.error({ err: error }, 'Visual editor media request failed')
      return Response.json(
        { error: 'Unable to load images. Check permissions and field restrictions.' },
        { status: 400 },
      )
    }
  }
