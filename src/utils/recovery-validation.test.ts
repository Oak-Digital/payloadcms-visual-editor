import { expect, it } from 'vitest'
import { validPageRecovery, validSharedRecovery } from './recovery-validation.js'

const page = () => ({
  owner: { id: '1', collection: 'pages', locale: 'en' },
  snapshot: {
    revision: 'r1',
    recoveryUser: 'users:1',
    fields: { 'layout.0.heading': { type: 'text', value: 'Old' } },
    orders: { layout: [{ id: 'a', label: 'Paragraph' }] },
  },
  changes: { 'layout.0.heading': 'New' },
  orders: { layout: ['a'] },
  additions: {},
  media: {},
})
it('validates page recovery before renderer access to nested rows and fields', () => {
  expect(validPageRecovery(page())).toBe(true)
  const p = page()
  for (const patch of [
    { snapshot: { ...p.snapshot, orders: { layout: null } } },
    { snapshot: { ...p.snapshot, fields: { 'layout.0.heading': null } } },
    { changes: { 'layout.1.unknown': 'Invalid' } },
    { orders: { layout: [null] } },
    { additions: { layout: [null] } },
    { media: { image: null } },
    { changes: JSON.parse('{"__proto__":"bad"}') },
  ])
    expect(validPageRecovery({ ...p, ...patch })).toBe(false)
})
it('validates shared nodes and every operation history entry', () => {
  const snapshot = {
    revision: 'r1',
    recoveryUser: 'users:1',
    document: {},
    nodes: [{ path: 'title', label: 'Title', type: 'text' }],
  }
  const shared = {
    target: { slug: 'navigation', id: '1', label: 'Menu' },
    base: snapshot,
    snapshot,
    operations: [{ type: 'set', path: 'title', value: 'New' }],
    undo: [[]],
    redo: [],
  }
  expect(validSharedRecovery(shared)).toBe(true)
  for (const patch of [
    { operations: [null] },
    { undo: [[null]] },
    { redo: [null] },
    { operations: [{ type: 'set', path: '__proto__.title' }] },
    {
      snapshot: {
        ...snapshot,
        nodes: [{ path: 'title', label: 'Title', type: 'group', children: [null] }],
      },
    },
  ])
    expect(validSharedRecovery({ ...shared, ...patch })).toBe(false)
})

it('recovers scalar and reference controls and rejects malformed option descriptors', () => {
  const p = page()
  const fields = {
    'layout.0.order': { type: 'radio', value: 'left', options: [{ value: 'left', label: 'Left' }] },
    'layout.0.addLink': { type: 'checkbox', value: false },
    'layout.0.link.relation': {
      type: 'reference',
      value: null,
      choices: [{ label: 'Page', value: { relationTo: 'pages', value: '1' } }],
    },
  }
  const recovery = {
    ...p,
    snapshot: { ...p.snapshot, fields },
    changes: { 'layout.0.order': 'left', 'layout.0.addLink': true },
  }
  expect(validPageRecovery(recovery)).toBe(true)
  fields['layout.0.order'].options = [null as never]
  expect(validPageRecovery(recovery)).toBe(false)
})
