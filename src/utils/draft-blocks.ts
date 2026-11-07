import { createHash } from 'node:crypto'
import type { CollectionSlug, Field, PayloadRequest } from 'payload'

import { type ArrangeOrder, safePath, setPath } from './arrange.js'
import { layoutReferences } from './layout-references.js'
import { duplicateBlock, projectBlockFields } from './duplicate-block.js'
import { assertFieldAccess, resolveField } from './rich-text.js'

export function blockDefaults(fields: Field[], label: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    if (
      field.type === 'row' ||
      field.type === 'collapsible' ||
      (field.type === 'group' && !('name' in field))
    ) {
      Object.assign(result, blockDefaults(field.fields, label))
    } else if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if ('name' in tab && tab.name) {
          result[tab.name] = blockDefaults(tab.fields, label)
        } else {
          Object.assign(result, blockDefaults(tab.fields, label))
        }
      }
    } else if ('name' in field) {
      if (
        'defaultValue' in field &&
        field.defaultValue !== undefined &&
        typeof field.defaultValue !== 'function'
      ) {
        result[field.name] = structuredClone(field.defaultValue)
      } else if (field.type === 'group') {
        result[field.name] = blockDefaults(field.fields, label)
      } else if (field.type === 'array' || field.type === 'blocks') {
        result[field.name] = []
      } else if ('hasMany' in field && field.hasMany) {
        result[field.name] = []
      } else if (field.type === 'checkbox') {
        result[field.name] = false
      } else if (
        (field.type === 'text' || field.type === 'textarea') &&
        /^(?:heading|title)$/.test(field.name)
      ) {
        result[field.name] = label
      } else if (field.type === 'richText') {
        result[field.name] = {
          root: {
            type: 'root',
            children: [
              {
                type: 'paragraph',
                children: [
                  {
                    type: 'text',
                    detail: 0,
                    format: 0,
                    mode: 'normal',
                    style: '',
                    text: 'Add your text here.',
                    version: 1,
                  },
                ],
                direction: null,
                format: '',
                indent: 0,
                version: 1,
              },
            ],
            direction: null,
            format: '',
            indent: 0,
            version: 1,
          },
        }
      }
    }
  }
  return result
}

/** Append virtual rows at stable paths. Reading this document never persists a draft. */
export async function appendDraftBlocks(
  fields: Field[],
  document: Record<string, unknown>,
  orders: unknown,
  req: PayloadRequest,
  enabled: Record<string, unknown>,
) {
  if (orders === undefined) {
    return
  }
  if (!Array.isArray(orders) || orders.length > 100) {
    throw new Error('Invalid block layout')
  }
  const paths = new Set<string>()
  for (const order of orders as ArrangeOrder[]) {
    if (!order || !safePath(order.path) || paths.has(order.path)) {
      throw new Error('Invalid block path')
    }
    paths.add(order.path)
    if (order.additions === undefined) {
      continue
    }
    if (!Array.isArray(order.additions) || order.additions.length > 100) {
      throw new Error('Too many new blocks')
    }
    const resolved = resolveField(fields, document, order.path)
    if (!resolved || resolved.field.type !== 'blocks' || !Array.isArray(resolved.value ?? [])) {
      throw new Error('Block field is unavailable')
    }
    await assertFieldAccess(resolved, document, req)
    const rows = [...(resolved.value ?? [])]
    const ids = new Set(rows.map((row) => String(row.id)))
    for (const addition of order.additions) {
      if (
        !addition ||
        typeof addition.id !== 'string' ||
        !/^[a-f0-9]{24}$/.test(addition.id) ||
        ids.has(addition.id)
      ) {
        throw new Error('Invalid new block')
      }
      const block = resolved.field.blocks.find((block) => block.slug === addition.blockType)
      if (!block) {
        throw new Error('Invalid block type')
      }
      let cloned: Record<string, unknown> | undefined
      if (addition.sourceId !== undefined) {
        const sourceIndex = rows.findIndex((row) => row.id === addition.sourceId)
        const source = rows[sourceIndex]
        if (typeof addition.sourceId !== 'string' || !source || source.blockType !== block.slug) {
          throw new Error('Duplicate source is unavailable')
        }
        const check = async (value: unknown, path: string): Promise<void> => {
          if (!value || typeof value !== 'object') return
          for (const [key, child] of Object.entries(value)) {
            if (key === 'id' || key === 'blockType') continue
            const childPath = `${path}.${key}`
            const field = resolveField(fields, document, childPath)
            if (field) await assertFieldAccess(field, document, req)
            await check(child, childPath)
          }
        }
        await check(source, `${order.path}.${sourceIndex}`)
        cloned = duplicateBlock(block.fields, source, addition.id)
      }
      if (addition.layoutSource !== undefined) {
        if (addition.sourceId !== undefined) throw new Error('Choose one copy source')
        const source = addition.layoutSource
        if (
          !source ||
          !['collection', 'id', 'path', 'rowId', 'revision'].every(
            (key) => typeof source[key as keyof typeof source] === 'string',
          ) ||
          !layoutReferences(fields).some(
            (ref) => ref.collection === source.collection && ref.layoutPath === source.path,
          )
        )
          throw new Error('Layout source is unavailable')
        if (!enabled[source.collection]) throw new Error('Layout collection is not enabled')
        const sourceCollection = req.payload.config.collections.find(
          (item) => item.slug === source.collection,
        )
        if (!sourceCollection?.versions?.drafts) throw new Error('Layout source requires drafts')
        const sourceDocument = await req.payload.findByID({
          collection: source.collection as CollectionSlug,
          id: source.id,
          depth: 0,
          draft: true,
          overrideAccess: false,
          req,
        })
        const versions = await req.payload.db.findVersions({
          collection: source.collection as CollectionSlug,
          limit: 1,
          pagination: false,
          req,
          sort: '-updatedAt',
          where: { and: [{ parent: { equals: source.id } }, { latest: { equals: true } }] },
        })
        if (
          !versions.docs[0] ||
          createHash('sha256').update(JSON.stringify(versions.docs[0])).digest('hex') !==
            source.revision
        )
          throw new Error('The shared layout changed. Select it again before copying.')
        const sourceField = resolveField(sourceCollection.fields, sourceDocument, source.path)
        if (sourceField?.field.type !== 'blocks' || !Array.isArray(sourceField.value))
          throw new Error('Source layout is unavailable')
        const sourceRow = sourceField.value.find(
          (row) => row.id === source.rowId && row.blockType === addition.blockType,
        )
        if (!sourceRow) throw new Error('Source block is unavailable')
        cloned = {
          ...duplicateBlock(block.fields, projectBlockFields(block.fields, sourceRow), addition.id),
          blockType: block.slug,
        }
        const proposed = structuredClone(document)
        setPath(proposed, order.path, [...rows, cloned])
        const check = async (value: unknown, path: string): Promise<void> => {
          if (!value || typeof value !== 'object') return
          for (const [key, child] of Object.entries(value)) {
            if (key === 'id' || key === 'blockType') continue
            const target = resolveField(fields, proposed, `${path}.${key}`)
            if (target) await assertFieldAccess(target, proposed, req)
            await check(child, `${path}.${key}`)
          }
        }
        await check(cloned, `${order.path}.${rows.length}`)
      }
      ids.add(addition.id)
      rows.push({
        ...(cloned ??
          blockDefaults(
            block.fields,
            typeof block.labels?.singular === 'string' ? block.labels.singular : block.slug,
          )),
        id: addition.id,
        blockType: block.slug,
      })
    }
    if (
      !Array.isArray(order.ids) ||
      new Set(order.ids).size !== order.ids.length ||
      order.ids.some((id) => !ids.has(id)) ||
      order.ids.length < (resolved.field.minRows ?? (resolved.field.required ? 1 : 0)) ||
      (resolved.field.maxRows !== undefined && order.ids.length > resolved.field.maxRows)
    ) {
      throw new Error('Invalid block layout')
    }
    setPath(document, order.path, rows)
  }
}
