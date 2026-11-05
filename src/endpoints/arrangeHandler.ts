import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  type CollectionSlug,
  commitTransaction,
  initTransaction,
  killTransaction,
  type PayloadHandler,
  type TypedLocale,
} from 'payload'

import {
  type ArrangeChange,
  type ArrangeOrder,
  type ArrangeSnapshot,
  reorderRows,
  safePath,
  setPath,
} from '../utils/arrange.js'
import { assertFieldAccess, assertSupportedRichText, resolveField } from '../utils/rich-text.js'
import { buildSourceMap } from '../utils/source-map.js'
import { uploadTargets, validateMedia } from '../utils/upload-fields.js'

export const createArrangeHandler =
  (collections: Partial<Record<CollectionSlug, true>>): PayloadHandler =>
  async (req) => {
    if (!req.user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
    let transaction = false
    try {
      const body = await req.json?.()
      if (
        !body ||
        !['publish', 'read', 'save'].includes(body.action) ||
        typeof body.collection !== 'string' ||
        !['number', 'string'].includes(typeof body.id) ||
        !Array.isArray(body.paths) ||
        !body.paths.every(safePath) ||
        !Array.isArray(body.orderPaths) ||
        !body.orderPaths.every(safePath)
      ) {
        throw new Error('Invalid editing request')
      }
      if (!collections[body.collection as CollectionSlug]) {
        return Response.json({ error: 'Collection is not enabled' }, { status: 403 })
      }
      const collection = req.payload.config.collections.find(
        (item) => item.slug === body.collection,
      )!
      if (!collection?.versions?.drafts) {
        throw new Error('Drafts are required')
      }
      const localization = req.payload.config.localization
      if (localization && !localization.localeCodes.includes(body.locale)) {
        throw new Error('A configured locale is required')
      }
      req.locale = body.locale as TypedLocale
      req.fallbackLocale = false
      transaction = await initTransaction(req)
      if (!transaction) {
        return Response.json({ error: 'Editing requires database transactions' }, { status: 503 })
      }
      const options = {
        id: body.id,
        collection: collection.slug,
        depth: 0,
        draft: true,
        fallbackLocale: false as const,
        locale: body.locale as TypedLocale,
        req,
      }
      const visible = await req.payload.findByID({ ...options, overrideAccess: false })
      if ((await collection.access.update({ id: body.id, data: visible, req })) === false) {
        throw new Error('Collection update access denied')
      }
      const versions = await req.payload.db.findVersions({
        collection: collection.slug,
        limit: 1,
        pagination: false,
        req,
        sort: '-updatedAt',
        where: { and: [{ parent: { equals: body.id } }, { latest: { equals: true } }] },
      })
      const latest = versions.docs[0]
      if (!latest) {
        throw new Error('A saved version is required')
      }
      const revision = createHash('sha256').update(JSON.stringify(latest)).digest('hex')
      const sourceMap = buildSourceMap(collection.fields, visible)
      const snapshot: ArrangeSnapshot = { fields: {}, orders: {}, revision }
      for (const path of body.paths as string[]) {
        const resolved = resolveField(collection.fields, visible, path)
        if (!resolved || !Object.hasOwn(sourceMap, path)) {
          continue
        }
        try {
          await assertFieldAccess(resolved, visible, req)
          const type = resolved.field.type
          if (type === 'richText') {
            assertSupportedRichText(resolved.field, resolved.value)
          }
          if (type === 'text' || type === 'textarea' || type === 'upload' || type === 'richText') {
            snapshot.fields[path] = {
              type,
              value: resolved.value ?? (type === 'upload' ? null : ''),
            }
          }
        } catch {
          /* Unsupported or protected fields remain unavailable in this mode. */
        }
      }
      for (const path of body.orderPaths as string[]) {
        const resolved = resolveField(collection.fields, visible, path)
        if (!resolved || resolved.field.type !== 'blocks' || !Array.isArray(resolved.value)) {
          continue
        }
        try {
          await assertFieldAccess(resolved, visible, req)
          const rows = resolved.value as Record<string, unknown>[]
          reorderRows(
            rows,
            rows.map((row) => String(row.id)),
          )
          snapshot.orders[path] = rows.map((row) => ({
            id: String(row.id),
            label: String(row.blockName || row.blockType),
          }))
        } catch {
          /* Protected block fields cannot be reordered. */
        }
      }
      if (body.action === 'read') {
        await commitTransaction(req)
        transaction = false
        return Response.json(snapshot)
      }
      if (body.revision !== revision) {
        await killTransaction(req)
        transaction = false
        return Response.json(
          {
            error:
              'This document changed. Reload before saving; your pending changes have not been applied.',
          },
          { status: 409 },
        )
      }
      if (
        !Array.isArray(body.changes) ||
        !Array.isArray(body.orders) ||
        body.changes.some((change: ArrangeChange) => !change || !safePath(change.path)) ||
        body.orders.some(
          (order: ArrangeOrder) =>
            !order ||
            !safePath(order.path) ||
            !Array.isArray(order.ids) ||
            order.ids.some((id) => typeof id !== 'string'),
        )
      ) {
        throw new Error('Invalid pending changes')
      }
      // Lock the version that normal Payload writers retire, including admin autosaves.
      for (const latestFlag of [false, true]) {
        await req.payload.db.updateVersion({
          id: latest.id,
          collection: collection.slug,
          req,
          versionData: { latest: latestFlag, version: structuredClone(latest.version) },
        })
      }
      const complete = await req.payload.findByID({ ...options, overrideAccess: true })
      const proposed = structuredClone(complete)
      const roots = new Set<string>()
      for (const change of body.changes as ArrangeChange[]) {
        const field = snapshot.fields[change.path]
        const resolved = resolveField(collection.fields, complete, change.path)
        if (!field || !resolved) {
          throw new Error('Field is unavailable for editing')
        }
        if (
          !isDeepStrictEqual(
            resolved.value,
            resolveField(collection.fields, visible, change.path)?.value,
          )
        ) {
          throw new Error('Field contains protected content')
        }
        if (field.type === 'richText') {
          assertSupportedRichText(resolved.field, change.value)
        } else if (field.type !== 'upload' && typeof change.value !== 'string') {
          throw new Error('Text must be a string')
        }
        setPath(proposed, change.path, change.value)
        roots.add(change.path.split('.')[0])
      }
      // Validate field access and uploads at their original paths before moving rows.
      for (const change of body.changes as ArrangeChange[]) {
        await assertFieldAccess(
          resolveField(collection.fields, proposed, change.path)!,
          complete,
          req,
          proposed,
          ['update'],
        )
        if (snapshot.fields[change.path].type === 'upload') {
          const target = uploadTargets(collection.fields, proposed).get(change.path)
          if (!target) {
            throw new Error('Unsupported image field')
          }
          await validateMedia(
            target,
            change.value as null | number | string,
            req,
            proposed,
            body.id,
          )
        }
      }
      // Nested reorders use original paths, deepest first; field edits always precede reordering.
      for (const order of [...(body.orders as ArrangeOrder[])].sort(
        (a, b) => b.path.split('.').length - a.path.split('.').length,
      )) {
        if (!snapshot.orders[order.path]) {
          throw new Error('Block field is unavailable')
        }
        const resolved = resolveField(collection.fields, proposed, order.path)!
        setPath(proposed, order.path, reorderRows(resolved.value, order.ids))
        await assertFieldAccess(
          resolveField(collection.fields, proposed, order.path)!,
          complete,
          req,
          proposed,
          ['update'],
        )
        roots.add(order.path.split('.')[0])
      }
      const status = body.action === 'publish' ? 'published' : 'draft'
      const data = Object.fromEntries([...roots].map((root) => [root, proposed[root]]))
      const result = await req.payload.update({
        ...options,
        data: { ...data, _status: status },
        draft: body.action === 'save',
        overrideAccess: false,
      })
      if (!result || result._status !== status) {
        throw new Error('The requested publication status was denied')
      }
      await commitTransaction(req)
      transaction = false
      return Response.json({ success: true })
    } catch (error) {
      if (transaction) {
        await killTransaction(req)
      }
      req.payload.logger.error({ err: error }, 'Arrange editor failed')
      const conflict =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 112
      return Response.json(
        {
          error: conflict
            ? 'This document changed. Reload before saving; your changes have not been applied.'
            : error instanceof Error
              ? error.message
              : 'Unable to save changes',
        },
        { status: conflict ? 409 : 400 },
      )
    }
  }
