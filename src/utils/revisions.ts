export type RevisionChange = { after: unknown; before: unknown; path: string }

/** Compare persisted values; document timestamps do not represent editorial changes. */
export function revisionChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RevisionChange[] {
  const changes: RevisionChange[] = []
  function visit(left: unknown, right: unknown, path: string) {
    if (JSON.stringify(left) === JSON.stringify(right)) {
      return
    }
    if (
      left &&
      right &&
      typeof left === 'object' &&
      typeof right === 'object' &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    ) {
      const a = left as Record<string, unknown>
      const b = right as Record<string, unknown>
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        visit(a[key], b[key], path ? `${path}.${key}` : key)
      }
    } else {
      changes.push({ after: right, before: left, path })
    }
  }
  for (const key of new Set([...Object.keys(after), ...Object.keys(before)])) {
    if (!['createdAt', 'id', 'updatedAt'].includes(key)) {
      visit(before[key], after[key], key)
    }
  }
  return changes
}
