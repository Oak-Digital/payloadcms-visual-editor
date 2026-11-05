import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  commitTransaction,
  initTransaction,
  killTransaction,
  type CollectionSlug,
  type PayloadHandler,
  type TypedLocale,
} from 'payload'
import {
  assertFieldAccess,
  assertSupportedRichText,
  isRichText,
  resolveField,
} from '../utils/rich-text.js'

export const createRichTextHandler =
  (collections: Partial<Record<CollectionSlug, true>>): PayloadHandler =>
  async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    let transaction = false
    try {
      const body = await req.json?.()
      if (
        !body ||
        !['read', 'save', 'publish'].includes(body.action) ||
        typeof body.collection !== 'string' ||
        !['string', 'number'].includes(typeof body.id) ||
        typeof body.path !== 'string' ||
        body.path
          .split('.')
          .some((part: string) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))
      ) {
        return Response.json({ error: 'Invalid rich-text request' }, { status: 400 })
      }
      if (!collections[body.collection as CollectionSlug])
        return Response.json({ error: 'Collection is not enabled' }, { status: 403 })
      const collection = req.payload.config.collections.find((c) => c.slug === body.collection)!
      const localization = req.payload.config.localization
      if (localization && !localization.localeCodes.includes(body.locale))
        return Response.json({ error: 'A configured locale is required' }, { status: 400 })
      if (!collection.versions?.drafts)
        return Response.json({ error: 'Drafts are required' }, { status: 400 })
      req.locale = body.locale as TypedLocale
      req.fallbackLocale = false
      transaction = await initTransaction(req)
      if (!transaction)
        return Response.json(
          { error: 'Rich-text editing requires database transactions' },
          { status: 503 },
        )
      const options = {
        id: body.id,
        collection: collection.slug,
        depth: 0,
        draft: true,
        locale: body.locale as TypedLocale,
        fallbackLocale: false as const,
        req,
      }
      const visible = await req.payload.findByID({ ...options, overrideAccess: false })
      const resolved = resolveField(collection.fields, visible, body.path)
      if (!resolved || !isRichText(resolved.value))
        throw new Error('Rich-text field is unavailable')
      await assertFieldAccess(
        resolved,
        visible,
        req,
        visible,
        body.action === 'read' ? ['read', 'update'] : ['read'],
      )
      const updateAccess = await collection.access.update({ req, id: body.id, data: visible })
      if (updateAccess === false) throw new Error('Collection update access denied')
      // Versions contain all locales; hashing the entire version detects sibling, row,
      // locale, and status changes without exposing their contents to the client.
      const versions = await req.payload.db.findVersions({
        collection: collection.slug,
        where: { and: [{ parent: { equals: body.id } }, { latest: { equals: true } }] },
        sort: '-updatedAt',
        limit: 1,
        pagination: false,
        req,
      })
      const latest = versions.docs[0]
      if (!latest) throw new Error('A saved version is required')
      const revision = createHash('sha256').update(JSON.stringify(latest)).digest('hex')
      assertSupportedRichText(resolved.field, resolved.value)
      if (body.action === 'read') {
        await commitTransaction(req)
        transaction = false
        return Response.json({
          value: resolved.value,
          revision,
          schemaPath: `collection.${collection.slug}.${resolved.schemaPath}`,
        })
      }
      if (body.revision !== revision) {
        await killTransaction(req)
        transaction = false
        return Response.json(
          {
            error:
              'This document changed. Reload the editor before saving; your changes have not been applied.',
          },
          { status: 409 },
        )
      }
      assertSupportedRichText(resolved.field, body.value)
      // Lock the version that other Payload writers retire when saving a new draft.
      // Concurrent writes conflict within this transaction, including admin autosaves.
      // A no-op update need not acquire a database write lock. Toggle and restore
      // within the transaction so no reader can observe the intermediate state.
      for (const latestFlag of [false, true]) {
        await req.payload.db.updateVersion({
          collection: collection.slug,
          id: latest.id,
          versionData: { latest: latestFlag, version: structuredClone(latest.version) },
          req,
        })
      }
      // Read complete sibling values only after access checks. Never return this document.
      const complete = await req.payload.findByID({ ...options, overrideAccess: true })
      const completeField = resolveField(collection.fields, complete, body.path)
      if (!completeField || !isDeepStrictEqual(completeField.value, resolved.value))
        throw new Error(
          'This field contains protected content and must be edited in the full admin editor',
        )
      const parts = body.path.split('.')
      const root = parts[0]
      const data: Record<string, any> = { [root]: structuredClone(complete[root]) }
      let parent: any = data
      for (const part of parts.slice(0, -1)) parent = parent[part]
      parent[parts.at(-1)!] = body.value
      const proposed = {
        ...complete,
        ...data,
        _status: body.action === 'publish' ? 'published' : 'draft',
      }
      await assertFieldAccess(
        resolveField(collection.fields, proposed, body.path)!,
        complete,
        req,
        proposed,
        ['update'],
      )
      const result = await req.payload.update({
        ...options,
        overrideAccess: false,
        draft: body.action === 'save',
        data: { ...data, _status: body.action === 'publish' ? 'published' : 'draft' },
      })
      if (!result || result._status !== (body.action === 'publish' ? 'published' : 'draft'))
        throw new Error('The requested draft or publication status was denied')
      await commitTransaction(req)
      transaction = false
      return Response.json({ success: true })
    } catch (error) {
      if (transaction) await killTransaction(req)
      req.payload.logger.error({ err: error }, 'Rich-text editing failed')
      const conflict =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 112
      return Response.json(
        {
          error: conflict
            ? 'This document changed. Reload the editor before saving; your changes have not been applied.'
            : error instanceof Error
              ? error.message
              : 'Unable to edit rich text',
        },
        { status: conflict ? 409 : 400 },
      )
    }
  }
