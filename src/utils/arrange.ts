export type ArrangeChange = { path: string; value: unknown }
export type ArrangeOrder = { ids: string[]; path: string }
export type ArrangeField = { type: 'richText' | 'text' | 'textarea' | 'upload'; value: unknown }
export type ArrangeSnapshot = {
  fields: Record<string, ArrangeField>
  orders: Record<string, { id: string; label: string }[]>
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
