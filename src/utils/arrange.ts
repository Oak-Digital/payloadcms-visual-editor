export type ArrangeChange = { path: string; value: unknown }
export type ArrangeOrder = {
  ids: string[]
  path: string
  additions?: { id: string; blockType: string }[]
}
export type ArrayRow = { id: string } | { relationship: string }
export type ArrangeArrayField = {
  type: 'array'
  value: ArrayRow[]
  label: string
  minRows: number
  maxRows?: number
  choices: { id: string; label: string }[]
  labels: Record<string, string>
}
export type ArrangeField =
  | { type: 'richText' | 'text' | 'textarea' | 'upload'; value: unknown; schemaPath?: string }
  | ArrangeArrayField

/** Retained rows come from the server, never from client-supplied content. */
export function arrangeArrayRows(
  rows: Record<string, unknown>[],
  value: unknown,
  field: ArrangeArrayField,
  relationship: string,
) {
  if (
    !Array.isArray(value) ||
    value.length < field.minRows ||
    (field.maxRows !== undefined && value.length > field.maxRows)
  ) {
    throw new Error('Invalid number of rows')
  }
  const used = new Set<string>()
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Object.keys(item).length !== 1) {
      throw new Error('Invalid array row')
    }
    if (typeof item.id === 'string') {
      const row = rows.find((row) => String(row.id) === item.id)
      if (!row || used.has(item.id)) throw new Error('Invalid existing row')
      used.add(item.id)
      return row
    }
    const choice = field.choices.find((choice) => choice.id === item.relationship)
    if (!choice) throw new Error('Select an available product')
    return { [relationship]: choice.id }
  })
}
export type ArrangeSnapshot = {
  fields: Record<string, ArrangeField>
  orders: Record<string, { id: string; label: string }[]>
  blockTypes?: Record<string, { slug: string; label: string }[]>
  blockLimits?: Record<string, { min: number; max?: number }>
  revision: string
}

export function safePath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path
      .split('.')
      .every((part) => part && !['__proto__', 'constructor', 'prototype'].includes(part))
  )
}

export function setPath(document: Record<string, unknown>, path: string, value: unknown) {
  if (!safePath(path)) {
    throw new Error('Invalid field path')
  }
  const parts = path.split('.')
  let parent = document
  for (const part of parts.slice(0, -1)) {
    if (!parent[part] || typeof parent[part] !== 'object') {
      throw new Error('Field parent is unavailable')
    }
    parent = parent[part] as Record<string, unknown>
  }
  parent[parts.at(-1)!] = value
}

/** A reorder is a permutation of existing rows, never client-provided block content. */
export function reorderRows(rows: Record<string, unknown>[], ids: string[]) {
  const byID = new Map(rows.map((row) => [String(row.id), row]))
  if (
    rows.some((row) => row.id == null) ||
    byID.size !== rows.length ||
    ids.length !== rows.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !byID.has(id))
  ) {
    throw new Error('Block order must contain every existing block exactly once')
  }
  return ids.map((id) => byID.get(id)!)
}

/** Keep selection attached to the same block when saved rows acquire new field paths. */
export function remapArrangePath(
  path: string,
  original: ArrangeSnapshot['orders'],
  orders: Record<string, string[]>,
) {
  const parts = path.split('.')
  for (const [orderPath, ids] of Object.entries(orders)) {
    if (!path.startsWith(`${orderPath}.`)) {
      continue
    }
    const depth = orderPath.split('.').length
    const row = original[orderPath]?.[Number(path.split('.')[depth])]
    const index = row ? ids.indexOf(row.id) : -1
    if (index >= 0) {
      parts[depth] = String(index)
    }
  }
  return parts.join('.')
}
