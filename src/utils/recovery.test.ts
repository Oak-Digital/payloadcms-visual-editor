import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearRecovery,
  readRecovery,
  recoveryValue,
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
  it('retains original revisions and reports conflicts without changing stored work', () => {
    expect(writeRecovery(localStorage, scope, 'original', { title: 'Pending' })).toBe(true)
    const raw = localStorage.getItem(recoveryKey(scope))
    expect(readRecovery(localStorage, scope, 'original', validate)).toMatchObject({
      status: 'available',
      conflict: false,
      record: { revision: 'original', value: { title: 'Pending' } },
    })
    expect(readRecovery(localStorage, scope, 'newer', validate)).toMatchObject({
      status: 'available',
      conflict: true,
    })
    expect(localStorage.getItem(recoveryKey(scope))).toBe(raw)
  })
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
  it('rejects malformed and unsupported records without deleting them', () => {
    for (const raw of [
      '{',
      'null',
      JSON.stringify({ version: 2 }),
      JSON.stringify({
        version: 1,
        revision: 'one',
        savedAt: new Date().toISOString(),
        value: { title: 42 },
      }),
    ]) {
      localStorage.setItem(recoveryKey(scope), raw)
      expect(readRecovery(localStorage, scope, 'one', validate)).toEqual({ status: 'invalid' })
      expect(localStorage.getItem(recoveryKey(scope))).toBe(raw)
    }
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
  it('clears only the requested document', () => {
    writeRecovery(localStorage, scope, 'one', { title: 'Saved' })
    const other = { ...scope, document: 'pages:2' }
    writeRecovery(localStorage, other, 'two', { title: 'Unsaved' })
    expect(clearRecovery(localStorage, scope)).toBe(true)
    expect(readRecovery(localStorage, scope, 'one', validate)).toEqual({ status: 'empty' })
    expect(readRecovery(localStorage, other, 'two', validate).status).toBe('available')
  })
})

it('shows readable rich text and empty values in conflict review', () => {
  expect(
    recoveryValue({ root: { children: [{ children: [{ text: 'Saved' }, { text: 'words' }] }] } }),
  ).toBe('Saved words')
  expect(recoveryValue(null)).toBe('Empty')
  expect(recoveryValue([{ relationship: 'watch-1' }])).toBe('Linked item watch-1')
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
