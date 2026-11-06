import type { Field, PayloadRequest } from 'payload'

import { type ArrangeOrder, safePath, setPath } from './arrange.js'
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
      ids.add(addition.id)
      rows.push({
        ...blockDefaults(
          block.fields,
          typeof block.labels?.singular === 'string' ? block.labels.singular : block.slug,
        ),
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
