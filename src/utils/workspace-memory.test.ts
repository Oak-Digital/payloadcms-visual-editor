import { describe, expect, it } from 'vitest'
import { canResumeSession } from './workspace-memory.js'
import type { ArrangeSnapshot } from './arrange.js'

const snapshot = (value = 'English', revision = 'one'): ArrangeSnapshot => ({
  recoveryUser: 'users:editor',
  revision,
  fields: {
    title: { type: 'text', value, localized: true },
    name: { type: 'text', value: 'Page', localized: false },
  },
  orders: { layout: [{ id: 'a', label: 'Hero' }] },
})
describe('retained language sessions', () => {
  it('keeps pending edits after another language changes the document revision', () => {
    expect(
      canResumeSession(snapshot(), snapshot('English', 'two'), { title: 'Edited' }, {}, {}),
    ).toBe(true)
  })
  it('does not rebase over a conflicting edit or another authenticated user', () => {
    expect(
      canResumeSession(snapshot(), snapshot('External change'), { title: 'Edited' }, {}, {}),
    ).toBe(false)
    expect(
      canResumeSession(snapshot(), { ...snapshot(), recoveryUser: 'users:other' }, {}, {}, {}),
    ).toBe(false)
  })
  it('accepts an already saved shared field but rejects changed list structure', () => {
    const fresh = snapshot()
    fresh.fields.name.value = 'Renamed'
    expect(canResumeSession(snapshot(), fresh, { name: 'Renamed' }, {}, {})).toBe(true)
    fresh.orders.layout.push({ id: 'b', label: 'New' })
    expect(canResumeSession(snapshot(), fresh, {}, { layout: ['a'] }, {})).toBe(false)
  })
  it('ignores prepared virtual rows when comparing the saved row identities', () => {
    const fresh = snapshot()
    fresh.orders.layout.push({ id: 'new', label: 'New' })
    expect(
      canResumeSession(
        snapshot(),
        fresh,
        {},
        { layout: ['new', 'a'] },
        { layout: [{ id: 'new' }] },
      ),
    ).toBe(true)
  })
})
