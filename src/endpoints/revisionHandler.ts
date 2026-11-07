import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  type CollectionSlug,
  type Field,
  type PayloadHandler,
  type TypedLocale,
  commitTransaction,
  initTransaction,
  killTransaction,
} from 'payload'
import { projectBlockFields } from '../utils/duplicate-block.js'
import { populatePreview } from '../utils/populate-preview.js'
import { assertFieldAccess, resolveField } from '../utils/rich-text.js'

const systemFields = new Set(['id', 'createdAt', 'updatedAt', '_status', '_sourceMap', 'deletedAt'])

/** Explicitly clear historical omissions; Payload merges missing group properties on update. */
function restoredValues(previous: any, historical: any): any {
  if (historical === undefined) return null
  if (!historical || typeof historical !== 'object' || Array.isArray(historical))
    return structuredClone(historical)
  const result: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(previous ?? {}), ...Object.keys(historical)])) {
    result[key] = restoredValues(previous?.[key], historical[key])
  }
  return result
}

export function revisionData(
  fields: Field[],
  current: Record<string, any>,
  historical: Record<string, any>,
) {
  const before = projectBlockFields(fields, current)
  const after = projectBlockFields(fields, historical)
  const data: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (!systemFields.has(key)) data[key] = restoredValues(before[key], after[key])
  }
  return data
}

export const createRevisionHandler =
  (enabled: Partial<Record<CollectionSlug, true>>): PayloadHandler =>
  async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    let transaction = false
    try {
      const body = await req.json?.()
      if (
        !body ||
        !['preview', 'restore'].includes(body.action) ||
        typeof body.collection !== 'string' ||
        !['string', 'number'].includes(typeof body.id) ||
        typeof body.versionId !== 'string'
      )
        throw new Error('Invalid revision request')
      if (!enabled[body.collection as CollectionSlug])
        return Response.json({ error: 'Collection is not enabled' }, { status: 403 })
      const collection = req.payload.config.collections.find(
        (item) => item.slug === body.collection,
      )
      if (!collection?.versions?.drafts) throw new Error('Drafts are required')
      if (
        req.payload.config.localization &&
        !req.payload.config.localization.localeCodes.includes(body.locale)
      )
        throw new Error('A configured locale is required')
      req.locale = body.locale as TypedLocale
      req.fallbackLocale = false
      transaction = await initTransaction(req)
      if (!transaction)
        return Response.json(
          { error: 'Revision operations require database transactions' },
          { status: 503 },
        )
      const options = {
        collection: collection.slug,
        id: body.id,
        locale: req.locale,
        fallbackLocale: false as const,
        depth: 0,
        draft: true,
        req,
      }
      const current = await req.payload.findByID({ ...options, overrideAccess: false })
      const access = await collection.access.update({ id: body.id, req, data: current })
      if (!access) throw new Error('Document update access denied')
      if (typeof access === 'object') {
        const allowed = await req.payload.find({
          ...options,
          overrideAccess: false,
          limit: 1,
          where: { and: [access, { id: { equals: body.id } }] },
        })
        if (!allowed.docs.length) throw new Error('Document update access denied')
      }
      const version = await req.payload.findVersionByID({
        collection: collection.slug,
        id: body.versionId,
        locale: req.locale,
        fallbackLocale: false,
        depth: 0,
        overrideAccess: false,
        req,
      })
      if (String(version.parent) !== String(body.id))
        throw new Error('Revision belongs to another document')
      const latest = (
        await req.payload.db.findVersions({
          collection: collection.slug,
          limit: 1,
          pagination: false,
          req,
          sort: '-updatedAt',
          where: { and: [{ parent: { equals: body.id } }, { latest: { equals: true } }] },
        })
      ).docs[0]
      if (!latest) throw new Error('Current revision is unavailable')
      const revision = createHash('sha256').update(JSON.stringify(latest)).digest('hex')
      if (body.action === 'preview') {
        const document = await populatePreview(collection.fields, version.version, req)
        await commitTransaction(req)
        transaction = false
        return Response.json({
          document: { ...document, id: body.id },
          revision,
          versionId: version.id,
          updatedAt: version.updatedAt,
        })
      }
      if (body.revision !== revision) {
        await killTransaction(req)
        transaction = false
        return Response.json(
          { error: 'This document changed. Preview the revision again before restoring.' },
          { status: 409 },
        )
      }
      // Match ordinary Payload writers' version retirement inside this transaction.
      for (const latestFlag of [false, true])
        await req.payload.db.updateVersion({
          collection: collection.slug,
          id: latest.id,
          req,
          versionData: { latest: latestFlag, version: structuredClone(latest.version) },
        })
      const complete = await req.payload.findByID({ ...options, overrideAccess: true })
      const rawVersion = await req.payload.findVersionByID({
        collection: collection.slug,
        id: body.versionId,
        locale: req.locale,
        fallbackLocale: false,
        depth: 0,
        overrideAccess: true,
        req,
      })
      const data = revisionData(collection.fields, complete, rawVersion.version)
      const proposed = { ...complete, ...data }
      const validate = async (left: any, right: any, path: string): Promise<void> => {
        if (isDeepStrictEqual(left, right)) return
        if (path) {
          const targets = [
            resolveField(collection.fields, complete, path),
            resolveField(collection.fields, proposed, path),
          ]
          for (const target of targets)
            if (target) await assertFieldAccess(target, complete, req, proposed)
        }
        if ((left && typeof left === 'object') || (right && typeof right === 'object')) {
          for (const key of new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])) {
            if (key === 'id' || key === 'blockType') continue
            await validate(left?.[key], right?.[key], path ? `${path}.${key}` : key)
          }
        }
      }
      for (const [key, value] of Object.entries(data)) await validate(complete[key], value, key)
      const document = await req.payload.update({
        ...options,
        overrideAccess: false,
        draft: true,
        data: { ...data, _status: 'draft' },
      })
      await commitTransaction(req)
      transaction = false
      return Response.json({ id: document.id, status: 'draft' })
    } catch (cause) {
      if (transaction) await killTransaction(req)
      return Response.json(
        { error: cause instanceof Error ? cause.message : 'Unable to use this revision' },
        { status: 400 },
      )
    }
  }
