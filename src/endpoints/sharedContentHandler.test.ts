// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('payload', () => ({
  initTransaction: vi.fn(async () => true),
  commitTransaction: vi.fn(),
  killTransaction: vi.fn(),
}))
import { createSharedContentHandler } from './sharedContentHandler.js'
function fixture(global = false) {
  const protectedField: any = {
    name: 'secret',
    type: 'text',
    access: { read: () => false, update: () => false },
  }
  const fields: any[] = [
    { name: 'title', type: 'text' },
    {
      name: 'items',
      type: 'array',
      maxRows: 3,
      fields: [
        { name: 'label', type: 'text' },
        protectedField,
        { name: 'children', type: 'array', fields: [{ name: 'label', type: 'text' }] },
      ],
    },
  ]
  let doc: any = {
    id: 'menu',
    title: 'Menu',
    items: [
      { id: 'a', label: 'Parent', secret: 'keep', children: [{ id: 'child', label: 'Child' }] },
    ],
    _status: 'published',
  }
  const cfg: any = {
    slug: global ? 'footer' : 'menus',
    fields,
    versions: { drafts: true },
    access: { update: () => true },
  }
  const visible = () => {
    const v = structuredClone(doc)
    v.items.forEach((r: any) => delete r.secret)
    return v
  }
  const read = vi.fn(async (o: any) => (o.overrideAccess ? structuredClone(doc) : visible()))
  const update = vi.fn(async (o: any) => {
    doc = { ...doc, ...o.data }
    return visible()
  })
  const payload: any = {
    config: {
      collections: global ? [] : [cfg],
      globals: global ? [cfg] : [],
      localization: { localeCodes: ['en', 'da'] },
    },
    findByID: read,
    findGlobal: read,
    update,
    updateGlobal: update,
    logger: { error: vi.fn() },
  }
  const handler = createSharedContentHandler({
    [cfg.slug]: {
      global,
      fields: ['title', 'items'],
      rowLabels: { items: 'label', 'items.*.children': 'label' },
    },
  })
  const call = (body: any = {}, user: any = { id: 'editor' }) =>
    handler({
      payload,
      user,
      json: async () => ({
        slug: cfg.slug,
        global,
        id: 'menu',
        action: 'read',
        locale: 'en',
        ...body,
      }),
    } as never)
  return { call, update, cfg, protectedField, payload, getDoc: () => doc }
}
describe('shared-content editing', () => {
  it('requires authentication and explicit opt-in', async () => {
    const f = fixture()
    expect((await f.call({}, null)).status).toBe(401)
    expect((await f.call({ slug: 'users' })).status).toBe(403)
  })
  it('supports nested previews without writing and hides protected values', async () => {
    const f = fixture(),
      base = await (await f.call()).json()
    const r = await f.call({
      action: 'preview',
      revision: base.revision,
      operations: [{ type: 'set', path: 'items.0.children.0.label', value: 'Changed' }],
    })
    const out = await r.json()
    expect(r.status).toBe(200)
    expect(out.document.items[0].children[0].label).toBe('Changed')
    expect(out.document.items[0].secret).toBeUndefined()
    expect(f.update).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'saves collections/globals with access checks and preserves unreadable siblings (%s)',
    async (global) => {
      const f = fixture(global),
        base = await (await f.call()).json()
      const r = await f.call({
        action: 'save',
        revision: base.revision,
        operations: [{ type: 'set', path: 'items.0.label', value: 'Draft' }],
      })
      expect(r.status).toBe(200)
      expect(f.getDoc().items[0].secret).toBe('keep')
      expect(f.getDoc()._status).toBe('draft')
      expect(f.update.mock.calls[0][0]).toMatchObject({
        overrideAccess: false,
        draft: true,
        locale: 'en',
      })
    },
  )
  it('rejects stale revisions without writing', async () => {
    const f = fixture()
    const r = await f.call({ action: 'publish', revision: 'stale', operations: [] })
    expect(r.status).toBe(409)
    expect(f.update).not.toHaveBeenCalled()
  })
  it('rejects protected, unconfigured and prototype paths', async () => {
    const f = fixture(),
      base = await (await f.call()).json()
    for (const path of ['items.0.secret', '_status', 'items.__proto__.label']) {
      expect(
        (
          await f.call({
            action: 'save',
            revision: base.revision,
            operations: [{ type: 'set', path, value: 'bad' }],
          })
        ).status,
      ).toBe(400)
    }
    expect(f.update).not.toHaveBeenCalled()
  })
  it('validates locales and scalar types', async () => {
    const f = fixture(),
      base = await (await f.call()).json()
    expect((await f.call({ locale: 'invalid' })).status).toBe(400)
    expect(
      (
        await f.call({
          action: 'preview',
          revision: base.revision,
          operations: [{ type: 'set', path: 'title', value: { bad: true } }],
        })
      ).status,
    ).toBe(400)
  })
  it('adds, moves and removes rows by identity', async () => {
    const f = fixture(),
      base = await (await f.call()).json()
    const id = '0123456789abcdef01234567'
    const r = await f.call({
      action: 'save',
      revision: base.revision,
      operations: [
        { type: 'add', path: 'items', id },
        { type: 'set', path: 'items.1.label', value: 'New' },
        { type: 'move', path: 'items', id, to: 0 },
        { type: 'remove', path: 'items', id: 'a' },
      ],
    })
    expect(r.status).toBe(200)
    expect(f.getDoc().items.map((r: any) => r.label)).toEqual(['New'])
  })
  it('rejects exceeding schema row limits', async () => {
    const f = fixture(),
      base = await (await f.call()).json()
    expect(
      (
        await f.call({
          action: 'save',
          revision: base.revision,
          operations: [1, 2, 3].map((i) => ({
            type: 'add',
            path: 'items',
            id: String(i).padStart(24, '0'),
          })),
        })
      ).status,
    ).toBe(400)
    expect(f.update).not.toHaveBeenCalled()
  })
})

it('enforces relationship filters before accepting draft changes', async () => {
  const f = fixture()
  f.cfg.fields[1].fields.push({
    name: 'related',
    type: 'relationship',
    relationTo: 'pages',
    filterOptions: { tenant: { equals: 'allowed' } },
  })
  f.payload.find = vi.fn(async () => ({ docs: [] }))
  const base = await (await f.call()).json()
  const response = await f.call({
    action: 'save',
    revision: base.revision,
    operations: [{ type: 'set', path: 'items.0.related', value: 'outside-tenant' }],
  })
  expect(response.status).toBe(400)
  expect(f.payload.find.mock.calls[0][0].where).toEqual({
    and: [{ tenant: { equals: 'allowed' } }, { id: { equals: 'outside-tenant' } }],
  })
  expect(f.update).not.toHaveBeenCalled()
})

it.each([false, true])(
  'reviews shared content against published without writes; global=%s',
  async (global) => {
    const f = fixture(global)
    const published = { title: 'Public menu', items: [], _status: 'published' }
    f.payload.find = vi.fn(async () => ({ docs: [published] }))
    if (global) {
      const read = f.payload.findGlobal.getMockImplementation()
      f.payload.findGlobal.mockImplementation((options: any) =>
        options.draft === false ? published : read(options),
      )
    }
    const { revision } = await (await f.call()).json()
    const response = await f.call({
      action: 'review',
      revision,
      operations: [{ type: 'set', path: 'title', value: 'Proposed menu' }],
    })
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({
      revision,
      published: true,
      changes: expect.arrayContaining([
        { path: 'title', before: 'Public menu', after: 'Proposed menu' },
      ]),
    })
    expect(JSON.stringify(result)).not.toContain('keep')
    expect(f.update).not.toHaveBeenCalled()
  },
)

it('enforces query-constrained update access for shared review', async () => {
  const f = fixture()
  f.cfg.access.update = () => ({ owner: { equals: 'other' } })
  f.payload.find = vi.fn(async () => ({ docs: [] }))
  expect((await f.call({ action: 'review', revision: 'irrelevant' })).status).toBe(400)
  expect(f.update).not.toHaveBeenCalled()
})
