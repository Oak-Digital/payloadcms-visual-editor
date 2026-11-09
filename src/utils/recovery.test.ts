import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRecovery,
  readRecovery,
  recoveryKey,
  writeRecovery,
  type RecoveryScope,
} from './recovery.js'

const records = new Map<string, string>()
const localStorage = {
  getItem: (key: string) => records.get(key) ?? null,
  setItem: (key: string, value: string) => {
    records.set(key, value)
  },
  removeItem: (key: string) => {
    records.delete(key)
  },
  clear: () => records.clear(),
}
const scope: RecoveryScope = {
  api: '/api',
  user: 'editor-1',
  kind: 'page',
  document: 'pages:1',
  locale: 'en',
}
const validate = (v: unknown): v is { title: string } =>
  !!v && typeof v === 'object' && typeof (v as { title?: unknown }).title === 'string'

beforeEach(() => {
  localStorage.clear()
  readRecovery(localStorage, scope, '', validate)
})
describe('browser recovery', () => {
  it('isolates users, APIs, locales, documents and editor kinds', () => {
    writeRecovery(localStorage, scope, 'one', { title: 'Private' })
    for (const patch of [
      { user: 'editor-2' },
      { api: '/other' },
      { locale: 'da' },
      { document: 'pages:2' },
      { kind: 'shared' as const },
    ]) {
      expect(readRecovery(localStorage, { ...scope, ...patch }, 'one', validate)).toEqual({
        status: 'empty',
      })
    }
    expect(() => recoveryKey({ ...scope, user: '' })).toThrow()
  })
  it('reports unavailable storage and quota failures', () => {
    const fail = () => {
      throw new Error('Storage denied')
    }
    const storage = { getItem: fail, setItem: fail, removeItem: fail }
    expect(readRecovery(storage, scope, 'one', validate)).toEqual({ status: 'unavailable' })
    expect(writeRecovery(storage, scope, 'one', { title: 'Pending' })).toBe(false)
    expect(clearRecovery(storage, scope)).toBe(false)
  })
})

it('preserves recovery changed by another tab', () => {
  // Distinct wrappers represent separate tab-local observations over the same storage.
  const tabA = { ...localStorage }
  const tabB = { ...localStorage }
  expect(writeRecovery(tabA, scope, 'one', { title: 'First tab' })).toBe(true)
  expect(readRecovery(tabB, scope, 'one', validate).status).toBe('available')
  expect(writeRecovery(tabB, scope, 'one', { title: 'Second tab' })).toBe(true)
  expect(writeRecovery(tabA, scope, 'one', { title: 'Old tab edit' })).toBe(false)
  expect(clearRecovery(tabA, scope)).toBe(false)
  expect(readRecovery(tabB, scope, 'one', validate)).toMatchObject({
    record: { value: { title: 'Second tab' } },
  })
})
