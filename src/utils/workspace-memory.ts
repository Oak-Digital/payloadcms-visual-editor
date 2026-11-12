import type { ArrangeSnapshot } from './arrange.js'

/** Lives only in the authenticated workspace window, across canvas navigation. */
export function workspaceMemory(): Map<string, any> {
  const host = window.parent as Window & { __oakEditorSessions?: Map<string, any> }
  try {
    if (
      host.location.origin !== window.location.origin ||
      !host.document.querySelector('[data-visual-editor-workspace]')
    )
      return new Map()
    return (host.__oakEditorSessions ??= new Map())
  } catch {
    return new Map()
  }
}

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** A different locale save changes the document revision. Rebase only unchanged edit bases. */
export function canResumeSession(
  previous: ArrangeSnapshot,
  fresh: ArrangeSnapshot,
  changes: Record<string, unknown>,
  orders: Record<string, string[]>,
  additions: Record<string, { id: string }[]>,
): boolean {
  if (!previous.recoveryUser || previous.recoveryUser !== fresh.recoveryUser) return false
  for (const path of Object.keys(changes)) {
    const before = previous.fields[path]
    const after = fresh.fields[path]
    if (!before || !after || before.type !== after.type) return false
    if (
      !equal(before.value, after.value) &&
      !(before.localized === false && equal(changes[path], after.value))
    )
      return false
  }
  for (const path of Object.keys(orders)) {
    const added = new Set(additions[path]?.map((row) => row.id))
    if (
      !equal(
        previous.orders[path],
        fresh.orders[path]?.filter((row) => !added.has(row.id)),
      )
    )
      return false
  }
  return true
}
