/** Recovery is browser-local and never substitutes for server access/revision checks. */
export type RecoveryScope = {
  api: string
  user: string
  kind: 'page' | 'shared'
  document: string
  locale?: string
}
export type RecoveryRecord<T> = {
  version: 1
  savedAt: string
  revision: string
  value: T
}
type StorageAdapter = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
// Compare the last observed value before writing so another tab's work is retained.
const observed = new WeakMap<StorageAdapter, Map<string, string | null>>()
function observations(storage: StorageAdapter) {
  let values = observed.get(storage)
  if (!values) {
    values = new Map()
    observed.set(storage, values)
  }
  return values
}
export type RecoveryRead<T> =
  | { status: 'empty' }
  | { status: 'unavailable' | 'invalid' }
  | { status: 'available'; record: RecoveryRecord<T>; conflict: boolean }

export function recoveryKey(scope: RecoveryScope): string {
  if (!scope.user) throw new Error('Recovery requires an authenticated user')
  return `oak-visual-recovery:${JSON.stringify([
    scope.api,
    scope.user,
    scope.kind,
    scope.document,
    scope.locale ?? null,
  ])}`
}

export function readRecovery<T>(
  storage: StorageAdapter,
  scope: RecoveryScope,
  revision: string,
  validate: (value: unknown) => value is T,
): RecoveryRead<T> {
  let raw: string | null
  try {
    raw = storage.getItem(recoveryKey(scope))
    observations(storage).set(recoveryKey(scope), raw)
  } catch {
    return { status: 'unavailable' }
  }
  if (raw === null) return { status: 'empty' }
  try {
    const record = JSON.parse(raw)
    if (
      !record ||
      record.version !== 1 ||
      typeof record.revision !== 'string' ||
      typeof record.savedAt !== 'string' ||
      !Number.isFinite(Date.parse(record.savedAt)) ||
      !validate(record.value)
    )
      return { status: 'invalid' }
    return { status: 'available', record, conflict: record.revision !== revision }
  } catch {
    return { status: 'invalid' }
  }
}

export function writeRecovery<T>(
  storage: StorageAdapter,
  scope: RecoveryScope,
  revision: string,
  value: T,
): boolean {
  try {
    const record: RecoveryRecord<T> = {
      version: 1,
      savedAt: new Date().toISOString(),
      revision,
      value,
    }
    const key = recoveryKey(scope)
    const values = observations(storage)
    if (storage.getItem(key) !== (values.get(key) ?? null)) return false
    const serialized = JSON.stringify(record)
    storage.setItem(key, serialized)
    values.set(key, serialized)
    return true
  } catch {
    return false
  }
}

export function clearRecovery(storage: StorageAdapter, scope: RecoveryScope): boolean {
  try {
    const key = recoveryKey(scope)
    const values = observations(storage)
    if (storage.getItem(key) !== (values.get(key) ?? null)) return false
    storage.removeItem(key)
    values.set(key, null)
    return true
  } catch {
    return false
  }
}

/** Plain content for conflict review, including Lexical text and ordered row IDs. */
export function recoveryValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Empty'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map(recoveryValue).join('\n')
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>
    if (typeof item.text === 'string') return item.text
    if (item.root) return recoveryValue(item.root)
    if (Array.isArray(item.children)) return item.children.map(recoveryValue).join(' ')
    if (typeof item.label === 'string') return item.label
    if (typeof item.id === 'string') return `Item ${item.id}`
    if (typeof item.relationship === 'string') return `Linked item ${item.relationship}`
  }
  return 'Structured content'
}
