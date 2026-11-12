type RevisionChange = { after: unknown; before: unknown; path: string; label?: string }

/** Keep nested block changes readable while preserving order and structural differences. */
export function publishedChanges(
  before: Record<string, any>,
  after: Record<string, any>,
): RevisionChange[] {
  const changes: RevisionChange[] = []
  const ignored = new Set(['_sourceMap', '_status', 'createdAt', 'id', 'updatedAt'])
  function visit(left: any, right: any, path: string, label = '') {
    if (JSON.stringify(left) === JSON.stringify(right)) {
      return
    }
    if (left?.root?.type === 'root' || right?.root?.type === 'root') {
      changes.push({ after: right, before: left, path, label })
      return
    }
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      if (Array.isArray(left) && Array.isArray(right)) {
        if (
          left.every((row) => row?.id) &&
          right.every((row) => row?.id) &&
          JSON.stringify(left.map((row) => row.id)) !== JSON.stringify(right.map((row) => row.id))
        ) {
          changes.push({
            after: right.map((row) => row.blockName || row.blockType || row.id),
            before: left.map((row) => row.blockName || row.blockType || row.id),
            path: `${path}.order`,
            label: `${label} › Order`,
          })
        }
      }
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (!ignored.has(key)) {
          const row = right[key] ?? left[key]
          const name = /^\d+$/.test(key)
            ? row?.blockName ||
              (row?.blockType
                ? `${readableLabel(row.blockType)} ${Number(key) + 1}`
                : `Item ${Number(key) + 1}`)
            : key === 'layout'
              ? 'Sections'
              : readableLabel(key)
          visit(
            left[key],
            right[key],
            path ? `${path}.${key}` : key,
            label ? `${label} › ${name}` : name,
          )
        }
      }
    } else {
      changes.push({ after: right, before: left, path, label })
    }
  }
  visit(before, after, '')
  return changes
}

export type PublishReviewData = {
  availability?: import('./page-settings.js').Availability
  previousAvailability?: import('./page-settings.js').Availability
  sharedFields?: string[]
  changes: RevisionChange[]
  draft: boolean
  label: string
  published: boolean
  revision: string
  usage?: {
    hasMore?: boolean
    incomplete?: boolean
    usages: { draft: boolean; id: string; label: string; published: boolean }[]
  }
}

export function readableLabel(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
}
