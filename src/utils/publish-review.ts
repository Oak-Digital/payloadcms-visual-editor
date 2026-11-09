type RevisionChange = { after: unknown; before: unknown; path: string }

/** Keep nested block changes readable while preserving order and structural differences. */
export function publishedChanges(
  before: Record<string, any>,
  after: Record<string, any>,
): RevisionChange[] {
  const changes: RevisionChange[] = []
  const ignored = new Set(['_sourceMap', '_status', 'createdAt', 'id', 'updatedAt'])
  function visit(left: any, right: any, path: string) {
    if (JSON.stringify(left) === JSON.stringify(right)) {
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
          })
        }
      }
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
        if (!ignored.has(key)) {
          visit(left[key], right[key], path ? `${path}.${key}` : key)
        }
      }
    } else {
      changes.push({ after: right, before: left, path })
    }
  }
  visit(before, after, '')
  return changes
}

export type PublishReviewData = {
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
