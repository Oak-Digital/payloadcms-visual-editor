// @vitest-environment node
import { expect, it, vi } from 'vitest'
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
it('previews, saves and reviews shared collections and globals while preserving protected siblings', async () => {
  for (const global of [false, true]) {
    const f = fixture(global)
    const published = structuredClone(f.getDoc())
    published.items.forEach((row: any) => delete row.secret)
    f.payload.find = vi.fn(async () => ({ docs: [published] }))
    if (global) {
      const read = f.payload.findGlobal.getMockImplementation()
      f.payload.findGlobal.mockImplementation((options: any) =>
        options.draft === false ? published : read(options),
      )
    }
    const base = await (await f.call()).json()
    const operations = [{ type: 'set', path: 'items.0.children.0.label', value: 'Draft child' }]
    const preview = await f.call({ action: 'preview', revision: base.revision, operations })
    expect(preview.status).toBe(200)
    const out = await preview.json()
    expect(out.document.items[0].children[0].label).toBe('Draft child')
    expect(out.document.items[0].secret).toBeUndefined()
    expect(f.update).not.toHaveBeenCalled()

    expect((await f.call({ action: 'save', revision: base.revision, operations })).status).toBe(200)
    expect(f.getDoc().items[0].secret).toBe('keep')
    expect(f.getDoc()._status).toBe('draft')
    expect(f.update.mock.calls[0][0]).toMatchObject({
      overrideAccess: false,
      draft: true,
      locale: 'en',
    })
    f.update.mockClear()
    const { revision } = await (await f.call()).json()
    const review = await f.call({
      action: 'review',
      revision,
      operations: [{ type: 'set', path: 'title', value: 'Pending title' }],
    })
    expect(review.status).toBe(200)
    const result = await review.json()
    expect(result).toMatchObject({
      revision,
      published: true,
      changes: expect.arrayContaining([
        { path: 'title', before: 'Menu', after: 'Pending title' },
        { path: 'items.0.children.0.label', before: 'Child', after: 'Draft child' },
      ]),
    })
    expect(JSON.stringify(result)).not.toContain('keep')
    expect(global ? f.payload.findGlobal : f.payload.find).toHaveBeenCalledWith(
      expect.objectContaining({ draft: false, overrideAccess: false, locale: 'en' }),
    )
    expect(f.update).not.toHaveBeenCalled()
  }
})

it('rejects unauthorized, stale and malformed shared changes without writing', async () => {
  const f = fixture()
  expect((await f.call({}, null)).status).toBe(401)
  expect((await f.call({ slug: 'users' })).status).toBe(403)
  expect((await f.call({ locale: 'invalid' })).status).toBe(400)
  expect((await f.call({ action: 'publish', revision: 'stale', operations: [] })).status).toBe(409)
  const { revision } = await (await f.call()).json()
  for (const operation of [
    { type: 'set', path: 'items.0.secret', value: 'bad' },
    { type: 'set', path: '_status', value: 'published' },
    { type: 'set', path: 'items.__proto__.label', value: 'bad' },
    { type: 'set', path: 'title', value: { bad: true } },
  ]) {
    expect(
      (await f.call({ action: 'save', revision, operations: [operation] })).status,
      operation.path,
    ).toBe(400)
  }
  f.cfg.fields[1].fields.push({
    name: 'related',
    type: 'relationship',
    relationTo: 'pages',
    filterOptions: { tenant: { equals: 'allowed' } },
  })
  f.payload.find = vi.fn(async () => ({ docs: [] }))
  expect(
    (
      await f.call({
        action: 'save',
        revision,
        operations: [{ type: 'set', path: 'items.0.related', value: 'outside-tenant' }],
      })
    ).status,
  ).toBe(400)
  expect(f.payload.find.mock.calls[0][0].where).toEqual({
    and: [{ tenant: { equals: 'allowed' } }, { id: { equals: 'outside-tenant' } }],
  })
  f.cfg.access.update = () => ({ owner: { equals: 'other' } })
  expect((await f.call({ action: 'review', revision })).status).toBe(400)
  expect(f.update).not.toHaveBeenCalled()
})

it('edits shared rows by identity, enforces row limits and returns publication field errors', async () => {
  const f = fixture()
  const base = await (await f.call()).json()
  const id = '0123456789abcdef01234567'
  expect(
    (
      await f.call({
        action: 'save',
        revision: base.revision,
        operations: [
          { type: 'add', path: 'items', id },
          { type: 'set', path: 'items.1.label', value: 'New' },
          { type: 'move', path: 'items', id, to: 0 },
          { type: 'remove', path: 'items', id: 'a' },
        ],
      })
    ).status,
  ).toBe(200)
  expect(f.getDoc().items.map((row: any) => row.label)).toEqual(['New'])
  f.update.mockClear()
  const { revision } = await (await f.call()).json()
  expect(
    (
      await f.call({
        action: 'save',
        revision,
        operations: [1, 2, 3].map((i) => ({
          type: 'add',
          path: 'items',
          id: String(i).padStart(24, '0'),
        })),
      })
    ).status,
  ).toBe(400)
  expect(f.update).not.toHaveBeenCalled()
  const fieldErrors = [{ path: 'title', label: 'Title', message: 'This field is required.' }]
  f.update.mockRejectedValueOnce(
    Object.assign(new Error('Long validation summary'), {
      name: 'ValidationError',
      data: { errors: fieldErrors },
    }),
  )
  const response = await f.call({ action: 'publish', revision, operations: [] })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ fieldErrors })
})

it('uses schema sections and validated multi-selects in collections and globals', async () => {
  for (const global of [false, true]) {
    const f = fixture(global)
    f.cfg.fields[0] = {
      type: 'collapsible',
      label: 'Content',
      fields: [f.cfg.fields[0], { name: 'private', type: 'text' }],
    }
    f.cfg.fields[1].fields.push({
      name: 'channels',
      type: 'select',
      hasMany: true,
      options: ['web', 'print'],
    })
    const read = await (await f.call()).json()
    expect(read.layout[0]).toMatchObject({
      type: 'collapsible',
      label: 'Content',
      children: [{ path: 'title' }],
    })
    expect(JSON.stringify(read.layout)).not.toContain('private')
    const operation = { type: 'set', path: 'items.0.channels', value: ['web', 'print'] }
    const preview = await (
      await f.call({ action: 'preview', revision: read.revision, operations: [operation] })
    ).json()
    expect(preview.document.items[0].channels).toEqual(['web', 'print'])
    expect(f.update).not.toHaveBeenCalled()
    for (const value of [['unknown'], 'web', ['web', 'web']]) {
      expect(
        (
          await f.call({
            action: 'save',
            revision: read.revision,
            operations: [{ ...operation, value }],
          })
        ).status,
      ).toBe(400)
    }
    expect(
      (await f.call({ action: 'save', revision: read.revision, operations: [operation] })).status,
    ).toBe(200)
    expect(f.getDoc().items[0].channels).toEqual(['web', 'print'])
  }
})
