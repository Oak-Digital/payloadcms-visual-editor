import { validationErrors } from '../utils/validation-errors.js'
import { publishedChanges } from '../utils/publish-review.js'
import { createHash } from 'node:crypto'
import {
  commitTransaction,
  initTransaction,
  killTransaction,
  type Field,
  type PayloadHandler,
  type PayloadRequest,
} from 'payload'
import type { SharedContentConfig, SharedNode, SharedOperation } from '../utils/shared-content.js'
import { resolveField, assertFieldAccess } from '../utils/rich-text.js'
import { safePath, setPath } from '../utils/arrange.js'

const label = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback
const at = (value: any, path: string) => path.split('.').reduce((v, k) => v?.[k], value)
const plain = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const scalarTypes = [
  'text',
  'textarea',
  'email',
  'number',
  'checkbox',
  'select',
  'radio',
  'relationship',
]

function defaults(fields: Field[]): Record<string, any> {
  const result: Record<string, any> = {}
  for (const field of fields) {
    if (
      field.type === 'row' ||
      field.type === 'collapsible' ||
      (field.type === 'group' && !('name' in field))
    )
      Object.assign(result, defaults(field.fields))
    else if ('name' in field) {
      if (
        'defaultValue' in field &&
        typeof field.defaultValue !== 'function' &&
        field.defaultValue !== undefined
      )
        result[field.name] = structuredClone(field.defaultValue)
      else if (field.type === 'group') result[field.name] = defaults(field.fields)
      else if (field.type === 'array' || field.type === 'blocks') result[field.name] = []
      else if (field.type === 'checkbox') result[field.name] = false
    }
  }
  return result
}

async function relationshipFilter(
  resolved: NonNullable<ReturnType<typeof resolveField>>,
  relationTo: string,
  data: Record<string, any>,
  req: PayloadRequest,
) {
  const field = resolved.field
  if (field.type !== 'relationship') throw new Error('Invalid relationship')
  const filter =
    typeof field.filterOptions === 'function'
      ? await field.filterOptions({
          req,
          id: data.id,
          data,
          siblingData: resolved.ancestors.at(-1)?.siblingData,
          blockData: resolved.ancestors.find((a) => a.siblingData?.blockType)?.siblingData,
          relationTo,
          user: req.user,
        })
      : field.filterOptions
  if (filter === false) throw new Error('No content is permitted by this field')
  return filter && typeof filter === 'object' ? filter : {}
}

async function checkRelationship(
  resolved: NonNullable<ReturnType<typeof resolveField>>,
  value: any,
  req: PayloadRequest,
  data: Record<string, any>,
) {
  const field = resolved.field
  if (field.type !== 'relationship' || value === null) return
  if (field.hasMany) throw new Error('Multiple relationships are not supported')
  const polymorphic = Array.isArray(field.relationTo)
  const relationTo = polymorphic ? value?.relationTo : field.relationTo
  const id = polymorphic ? value?.value : value
  if (
    !(typeof id === 'string' || typeof id === 'number') ||
    !(polymorphic ? field.relationTo.includes(relationTo) : relationTo === field.relationTo)
  )
    throw new Error('Invalid relationship')
  const filter = await relationshipFilter(resolved, relationTo, data, req)
  const found = await req.payload.find({
    collection: relationTo,
    where: { and: [filter, { id: { equals: id } }] },
    limit: 1,
    depth: 0,
    overrideAccess: false,
    req,
  })
  if (!found.docs.length) throw new Error('Select an accessible related document')
}

export async function applySharedOperations(
  fields: Field[],
  document: Record<string, any>,
  operations: SharedOperation[],
  roots: string[],
  req: PayloadRequest,
) {
  const next = structuredClone(document)
  for (const op of operations) {
    if (!op || !safePath(op.path) || !roots.includes(op.path.split('.')[0]))
      throw new Error('Field is not enabled')
    const resolved = resolveField(fields, next, op.path)
    if (!resolved) throw new Error('Field is unavailable')
    await assertFieldAccess(resolved, document, req, next)
    const field = resolved.field
    if (op.type === 'set') {
      if (!scalarTypes.includes(field.type)) throw new Error('Unsupported field')
      if (field.type === 'relationship') await checkRelationship(resolved, op.value, req, next)
      else if (
        field.type === 'checkbox'
          ? typeof op.value !== 'boolean'
          : field.type === 'number'
            ? op.value !== null && typeof op.value !== 'number'
            : typeof op.value !== 'string' && op.value !== null
      )
        throw new Error('Invalid field value')
      if (
        (field.type === 'select' || field.type === 'radio') &&
        op.value !== null &&
        !field.options.some((o) => (typeof o === 'string' ? o : o.value) === op.value)
      )
        throw new Error('Invalid option')
      setPath(next, op.path, op.value)
    } else {
      if (field.type !== 'array' && field.type !== 'blocks') throw new Error('Expected rows')
      const rows = resolved.value ?? []
      if (!Array.isArray(rows)) throw new Error('Invalid rows')
      if (op.type === 'add') {
        if (!/^[a-f0-9]{24}$/.test(op.id) || rows.some((r) => r.id === op.id))
          throw new Error('Invalid new row')
        if (field.maxRows !== undefined && rows.length >= field.maxRows)
          throw new Error('Maximum rows reached')
        const block =
          field.type === 'blocks' ? field.blocks.find((b) => b.slug === op.blockType) : undefined
        if (field.type === 'blocks' && !block) throw new Error('Invalid block')
        rows.push({
          ...defaults(field.type === 'array' ? field.fields : block!.fields),
          id: op.id,
          ...(block ? { blockType: block.slug } : {}),
        })
      } else {
        const index = rows.findIndex((r) => String(r.id) === op.id)
        if (index < 0) throw new Error('Row is unavailable')
        if (op.type === 'remove') {
          if (rows.length <= (field.minRows ?? (field.required ? 1 : 0)))
            throw new Error('Minimum rows reached')
          rows.splice(index, 1)
        } else if (
          op.type === 'move' &&
          Number.isInteger(op.to) &&
          op.to! >= 0 &&
          op.to! < rows.length
        )
          rows.splice(op.to!, 0, rows.splice(index, 1)[0])
        else throw new Error('Invalid row operation')
      }
      setPath(next, op.path, rows)
    }
  }
  return next
}

async function nodes(
  fields: Field[],
  doc: any,
  req: PayloadRequest,
  rowLabels: Record<string, string>,
  schema: Field[],
  prefix = '',
  sibling = doc,
): Promise<SharedNode[]> {
  const result: SharedNode[] = []
  for (const f of fields) {
    if ((f.admin && 'hidden' in f.admin && f.admin.hidden) || ('virtual' in f && f.virtual))
      continue
    if (
      f.admin?.condition &&
      !f.admin.condition(doc, sibling, {
        user: req.user,
        blockData: sibling,
        operation: 'update',
        path: prefix.split('.').filter(Boolean),
      })
    )
      continue
    if (f.type === 'row' || f.type === 'collapsible' || (f.type === 'group' && !('name' in f))) {
      result.push(...(await nodes(f.fields, doc, req, rowLabels, schema, prefix, sibling)))
      continue
    }
    if (f.type === 'tabs') {
      for (const tab of f.tabs)
        result.push(
          ...(await nodes(
            tab.fields,
            doc,
            req,
            rowLabels,
            schema,
            'name' in tab ? `${prefix}${tab.name}.` : prefix,
            'name' in tab ? sibling?.[tab.name] : sibling,
          )),
        )
      continue
    }
    if (!('name' in f) || f.name === 'id' || f.name === '_status') continue
    const path = prefix + f.name,
      value = at(doc, path),
      resolved = resolveField(schema, doc, path)
    try {
      if (!resolved) continue
      await assertFieldAccess(resolved, doc, req)
    } catch {
      continue
    }
    const node: SharedNode = { path, label: label(f.label, f.name), type: f.type, value }
    if (f.type === 'group') {
      node.children = await nodes(f.fields, doc, req, rowLabels, schema, path + '.', value)
      if (f.label === false) {
        result.push(...node.children)
        continue
      }
    } else if (f.type === 'array' || f.type === 'blocks') {
      node.minRows = f.minRows ?? (f.required ? 1 : 0)
      node.maxRows = f.maxRows
      if (f.type === 'blocks')
        node.blocks = f.blocks.map((b) => ({
          value: b.slug,
          label: label(b.labels?.singular, b.slug),
        }))
      node.rows = []
      for (const [i, row] of (Array.isArray(value) ? value : []).entries()) {
        const child =
          f.type === 'array' ? f.fields : f.blocks.find((b) => b.slug === row.blockType)?.fields
        if (!child) continue
        const key = path.replace(/\.\d+(?=\.|$)/g, '.*')
        const rowLabel =
          at(row, rowLabels[key] || 'title') ||
          row.heading ||
          row.label ||
          row.blockName ||
          row.blockType ||
          `Item ${i + 1}`
        node.rows.push({
          id: String(row.id),
          label: String(rowLabel),
          children: await nodes(child, doc, req, rowLabels, schema, `${path}.${i}.`, row),
        })
      }
    } else if (f.type === 'select' || f.type === 'radio') {
      if ('hasMany' in f && f.hasMany) continue
      node.options = f.options.map((o) =>
        typeof o === 'string'
          ? { label: o, value: o }
          : { label: label(o.label, o.value), value: o.value },
      )
    } else if (f.type === 'relationship') {
      if (f.hasMany) continue
      node.relations = typeof f.relationTo === 'string' ? [f.relationTo] : f.relationTo
      node.polymorphic = Array.isArray(f.relationTo)
      if (value) {
        const relationTo = node.polymorphic ? value.relationTo : node.relations[0],
          id = node.polymorphic ? value.value : value
        try {
          const collection = req.payload.config.collections.find((c) => c.slug === relationTo)
          const related = await req.payload.findByID({
            collection: relationTo,
            id,
            depth: 0,
            overrideAccess: false,
            req,
          })
          node.displayValue = String(related[collection?.admin.useAsTitle || 'id'] || id)
        } catch {
          node.displayValue = 'Unavailable content'
        }
      }
    } else if (!scalarTypes.includes(f.type)) continue
    result.push(node)
  }
  return result
}

async function populatePreview(fields: Field[], doc: any, req: PayloadRequest): Promise<any> {
  if (!doc) return doc
  const result = structuredClone(doc)
  for (const f of fields) {
    if (f.type === 'row' || f.type === 'collapsible' || (f.type === 'group' && !('name' in f)))
      Object.assign(result, await populatePreview(f.fields, doc, req))
    else if ('name' in f) {
      const v = doc[f.name]
      if (f.type === 'group') result[f.name] = await populatePreview(f.fields, v, req)
      if ((f.type === 'array' || f.type === 'blocks') && Array.isArray(v))
        result[f.name] = await Promise.all(
          v.map((row) =>
            populatePreview(
              f.type === 'array'
                ? f.fields
                : (f.blocks.find((b) => b.slug === row.blockType)?.fields ?? []),
              row,
              req,
            ),
          ),
        )
      if (f.type === 'relationship' && v && !f.hasMany) {
        const poly = Array.isArray(f.relationTo),
          collection = poly ? v.relationTo : f.relationTo,
          id = poly ? v.value : v
        if (typeof id === 'string' || typeof id === 'number') {
          try {
            const related = await req.payload.findByID({
              collection,
              id,
              depth: 4,
              draft: true,
              overrideAccess: false,
              req,
            })
            result[f.name] = poly ? { relationTo: collection, value: related } : related
          } catch {
            result[f.name] = null
          }
        }
      }
    }
  }
  return result
}

export const createSharedContentHandler =
  (enabled: SharedContentConfig): PayloadHandler =>
  async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    let transaction = false
    try {
      const body = await req.json?.()
      if (
        !body ||
        typeof body.slug !== 'string' ||
        !['read', 'preview', 'save', 'publish', 'choices', 'review'].includes(body.action)
      )
        throw new Error('Invalid shared-content request')
      const entry = enabled[body.slug]
      if (!entry || Boolean(body.global) !== Boolean(entry.global))
        return Response.json({ error: 'Content is not enabled' }, { status: 403 })
      const config = entry.global
        ? req.payload.config.globals.find((g) => g.slug === body.slug)
        : req.payload.config.collections.find((c) => c.slug === body.slug)
      if (!config) throw new Error('Content is unavailable')
      if (!entry.global && !['string', 'number'].includes(typeof body.id))
        throw new Error('Document ID is required')
      const localization = req.payload.config.localization
      if (localization && !localization.localeCodes.includes(body.locale))
        throw new Error('A configured locale is required')
      req.locale = body.locale
      req.fallbackLocale = false
      const options = {
        depth: 0,
        draft: true,
        locale: body.locale,
        fallbackLocale: false as const,
        overrideAccess: false,
        req,
      }
      transaction = await initTransaction(req)
      if (!transaction)
        return Response.json({ error: 'Editing requires database transactions' }, { status: 503 })
      const doc: Record<string, any> = entry.global
        ? await req.payload.findGlobal({ ...options, slug: body.slug })
        : await req.payload.findByID({ ...options, collection: body.slug, id: body.id })
      const access = await config.access.update({ req, id: body.id, data: doc })
      if (access === false) throw new Error('Update access denied')
      if (!entry.global && typeof access === 'object') {
        const allowed = await req.payload.find({
          ...options,
          collection: body.slug,
          limit: 1,
          where: { and: [access, { id: { equals: body.id } }] },
        })
        if (!allowed.docs.length) throw new Error('Update access denied')
      }
      // Include raw persisted state in the revision; transactions also detect concurrent writes.
      const complete: Record<string, any> = entry.global
        ? await req.payload.findGlobal({ ...options, slug: body.slug, overrideAccess: true })
        : await req.payload.findByID({
            ...options,
            collection: body.slug,
            id: body.id,
            overrideAccess: true,
          })
      let revision = createHash('sha256').update(JSON.stringify(complete)).digest('hex')
      if (body.action !== 'read' && body.action !== 'choices' && body.revision !== revision) {
        await killTransaction(req)
        transaction = false
        return Response.json(
          { error: 'This content changed. Reopen it before saving; your edits are retained.' },
          { status: 409 },
        )
      }
      const operations = body.operations ?? []
      if (!Array.isArray(operations) || operations.length > 1000) throw new Error('Invalid edits')
      let proposed = await applySharedOperations(config.fields, doc, operations, entry.fields, req)
      if (body.action === 'choices') {
        if (!safePath(body.path) || !entry.fields.includes(body.path.split('.')[0]))
          throw new Error('Field is not enabled')
        const target = resolveField(config.fields, proposed, body.path)
        if (!target || target.field.type !== 'relationship')
          throw new Error('Invalid relationship field')
        await assertFieldAccess(target, doc, req)
        const relation = body.relationTo,
          relations = Array.isArray(target.field.relationTo)
            ? target.field.relationTo
            : [target.field.relationTo]
        if (!relations.includes(relation)) throw new Error('Invalid collection')
        const collection = req.payload.config.collections.find((c) => c.slug === relation)!,
          title = collection.admin.useAsTitle || 'id'
        const filter = await relationshipFilter(target, relation, proposed, req)
        const found = await req.payload.find({
          ...options,
          collection: relation,
          limit: 30,
          page: Number.isInteger(body.page) && body.page > 0 ? body.page : 1,
          where: {
            and: [
              filter,
              ...(body.search ? [{ [title]: { like: String(body.search).slice(0, 100) } }] : []),
            ],
          },
        })
        await commitTransaction(req)
        transaction = false
        return Response.json({
          choices: found.docs.map((d) => ({ id: String(d.id), label: String(d[title] || d.id) })),
          hasNext: found.hasNextPage,
        })
      }
      const drafts = !!config.versions && !!config.versions.drafts
      if (body.action === 'review') {
        let published: Record<string, any> | undefined
        if (entry.global) {
          const result = await req.payload.findGlobal({ ...options, slug: body.slug, draft: false })
          if (!drafts || result._status === 'published') published = result
        } else {
          published = (
            await req.payload.find({
              ...options,
              collection: body.slug,
              draft: false,
              limit: 1,
              where: {
                and: [
                  { id: { equals: body.id } },
                  ...(drafts ? [{ _status: { equals: 'published' } }] : []),
                ],
              },
            })
          ).docs[0]
        }
        await commitTransaction(req)
        transaction = false
        return Response.json({
          revision,
          published: !!published,
          draft: doc._status === 'draft',
          changes: publishedChanges(published || {}, proposed),
        })
      }
      if (body.action === 'save' || body.action === 'publish') {
        if (body.action === 'save' && !drafts)
          throw new Error('This content does not support drafts')
        const completeProposed = await applySharedOperations(
          config.fields,
          complete,
          operations,
          entry.fields,
          req,
        )
        const roots = new Set(operations.map((op: SharedOperation) => op.path.split('.')[0]))
        const data = {
          ...Object.fromEntries([...roots].map((root) => [root, completeProposed[root as string]])),
          ...(drafts ? { _status: body.action === 'publish' ? 'published' : 'draft' } : {}),
        }
        proposed = entry.global
          ? await req.payload.updateGlobal({
              ...options,
              slug: body.slug,
              data,
              draft: body.action === 'save',
              ...(body.action === 'publish' && req.locale
                ? { publishSpecificLocale: req.locale }
                : {}),
            })
          : await req.payload.update({
              ...options,
              collection: body.slug,
              id: body.id,
              data,
              draft: body.action === 'save',
              ...(body.action === 'publish' && req.locale
                ? { publishSpecificLocale: req.locale }
                : {}),
            })
        if (drafts && proposed._status !== data._status)
          throw new Error('Publication status denied')
        const updated = entry.global
          ? await req.payload.findGlobal({ ...options, slug: body.slug, overrideAccess: true })
          : await req.payload.findByID({
              ...options,
              collection: body.slug,
              id: body.id,
              overrideAccess: true,
            })
        revision = createHash('sha256').update(JSON.stringify(updated)).digest('hex')
      }
      const selected = config.fields.filter((f) => !('name' in f) || entry.fields.includes(f.name))
      const tree = (
        await nodes(selected, proposed, req, entry.rowLabels ?? {}, config.fields)
      ).filter((node) => entry.fields.includes(node.path.split('.')[0]))
      const previewDocument = await populatePreview(config.fields, proposed, req)
      await commitTransaction(req)
      transaction = false
      return Response.json({
        recoveryUser: `${req.user.collection}:${req.user.id}`,
        revision,
        nodes: tree,
        document: previewDocument,
        drafts,
        status: proposed._status,
      })
    } catch (error) {
      if (transaction) await killTransaction(req)
      req.payload.logger.error({ err: error }, 'Shared content editor failed')
      return Response.json(
        {
          error: error instanceof Error ? error.message : 'Unable to edit shared content',
          fieldErrors: validationErrors(error, req),
        },
        { status: 400 },
      )
    }
  }
