// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('payload', () => ({
  initTransaction: vi.fn(async () => true),
  commitTransaction: vi.fn(),
  killTransaction: vi.fn(),
}))
import { killTransaction } from 'payload'
import { createArrangeHandler } from './arrangeHandler.js'

const richText = {
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        children: [
          {
            type: 'text',
            version: 1,
            text: 'Hello',
            format: 1,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
    ],
    format: '',
    indent: 0,
    direction: null,
  },
}
function fixture() {
  const text: any = { name: 'heading', type: 'text' }
  const block: any = {
    name: 'layout',
    type: 'blocks',
    blocks: [
      {
        slug: 'section',
        fields: [
          text,
          { name: 'body', type: 'richText', editor: { editorConfig: { features: { nodes: [] } } } },
          { name: 'image', type: 'upload', relationTo: 'media' },
        ],
      },
    ],
  }
  const doc = {
    id: 'page',
    layout: [
      {
        id: 'a',
        blockType: 'section',
        heading: 'First',
        body: richText,
        image: 'old',
        protectedSibling: 'Keep',
      },
      { id: 'b', blockType: 'section', heading: 'Second' },
    ],
    other: 'Unchanged',
  }
  const collection: any = {
    slug: 'pages',
    versions: { drafts: true },
    access: { update: vi.fn(() => true) },
    fields: [block],
  }
  const latest = { id: 'version', version: doc, updatedAt: '2026-11-05', latest: true }
  const payload = {
    config: {
      localization: { localeCodes: ['en', 'da'] },
      collections: [collection, { slug: 'media', upload: {} }],
    },
    findByID: vi.fn(async () => structuredClone(doc)),
    find: vi.fn(async () => ({ docs: [{ id: 'new', mimeType: 'image/jpeg' }] })),
    update: vi.fn(async (options: any) => ({ ...doc, ...options.data })),
    db: { findVersions: vi.fn(async () => ({ docs: [latest] })), updateVersion: vi.fn() },
    logger: { error: vi.fn() },
  }
  const handler = createArrangeHandler({ pages: true })
  const base = {
    id: 'page',
    collection: 'pages',
    locale: 'en',
    action: 'read',
    paths: ['layout.0.heading', 'layout.1.heading', 'layout.0.body', 'layout.0.image'],
    orderPaths: ['layout'],
  }
  const call = (body: object = {}, user: object | null = { id: 'editor' }) =>
    handler({ payload, user, json: async () => ({ ...base, ...body }) } as never)
  return { call, payload, latest, doc, text, block, collection }
}

describe('arrange editor batch', () => {
  it.each([undefined, []])('adds the first block to an empty layout (%j)', async (layout) => {
    const { call, doc, payload } = fixture()
    Object.assign(doc, { layout })
    const snapshot = await (await call({ paths: [] })).json()
    expect(snapshot.orders.layout).toEqual([])
    const response = await call({
      action: 'save',
      revision: snapshot.revision,
      changes: [],
      orders: [
        {
          path: 'layout',
          ids: ['0123456789abcdef01234567'],
          additions: [{ id: '0123456789abcdef01234567', blockType: 'section' }],
        },
      ],
    })
    expect(response.status).toBe(200)
    expect(payload.update.mock.calls[0][0].data.layout).toHaveLength(1)
  })
  it('adds and removes allowed blocks while preserving retained row data', async () => {
    const { call, payload } = fixture()
    const { revision, blockTypes } = await (await call()).json()
    expect(blockTypes.layout).toEqual([{ slug: 'section', label: 'section' }])
    const response = await call({
      action: 'save',
      revision,
      changes: [],
      orders: [
        {
          path: 'layout',
          ids: ['b', '0123456789abcdef01234567'],
          additions: [{ id: '0123456789abcdef01234567', blockType: 'section' }],
        },
      ],
    })
    expect(response.status).toBe(200)
    const rows = payload.update.mock.calls[0][0].data.layout
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'b', heading: 'Second' })
    expect(rows[1]).toMatchObject({ id: '0123456789abcdef01234567', blockType: 'section' })
    expect(rows[1].body.root).toMatchObject({ type: 'root', children: [] })
  })

  it('lists editable block fields even when their values are not rendered', async () => {
    const { call } = fixture()
    const snapshot = await (await call({ paths: [] })).json()
    expect(snapshot.fields['layout.1.heading']).toEqual({ type: 'text', value: 'Second' })
  })

  it('rejects unknown block types and IDs', async () => {
    const { call, payload } = fixture()
    const { revision } = await (await call()).json()
    const response = await call({
      action: 'save',
      revision,
      changes: [],
      orders: [
        {
          path: 'layout',
          ids: ['a', 'b', '0123456789abcdef01234567'],
          additions: [{ id: '0123456789abcdef01234567', blockType: 'unknown' }],
        },
      ],
    })
    expect(response.status).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('enforces block row limits', async () => {
    const { call, block, payload } = fixture()
    block.minRows = 2
    block.maxRows = 2
    const { revision, blockLimits } = await (await call()).json()
    expect(blockLimits.layout).toEqual({ min: 2, max: 2 })
    const remove = await call({
      action: 'save',
      revision,
      changes: [],
      orders: [{ path: 'layout', ids: ['a'] }],
    })
    expect(remove.status).toBe(400)
    const add = await call({
      action: 'save',
      revision,
      changes: [],
      orders: [
        {
          path: 'layout',
          ids: ['a', 'b', '0123456789abcdef01234567'],
          additions: [{ id: '0123456789abcdef01234567', blockType: 'section' }],
        },
      ],
    })
    expect(add.status).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })

  it('rejects removing a row with protected content', async () => {
    const { call, payload, doc } = fixture()
    const { revision } = await (await call()).json()
    const visible = structuredClone(doc)
    delete (visible.layout[0] as Record<string, unknown>).protectedSibling
    payload.findByID.mockResolvedValueOnce(visible).mockResolvedValueOnce(structuredClone(doc))
    const response = await call({
      action: 'save',
      revision,
      changes: [],
      orders: [{ path: 'layout', ids: ['b'] }],
    })
    expect(response.status).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })
  it('saves text, rich text and images before reordering, preserving siblings in one update', async () => {
    const { call, payload } = fixture()
    const snapshot = await (await call()).json()
    const body = structuredClone(richText)
    body.root.children[0].children[0].text = 'Formatted edit'
    const response = await call({
      action: 'save',
      revision: snapshot.revision,
      changes: [
        { path: 'layout.0.heading', value: 'Edited' },
        { path: 'layout.0.body', value: body },
        { path: 'layout.0.image', value: 'new' },
      ],
      orders: [{ path: 'layout', ids: ['b', 'a'] }],
    })
    expect(await response.json()).toEqual({ success: true })
    expect(payload.update).toHaveBeenCalledTimes(1)
    const options = payload.update.mock.calls[0][0]
    expect(options).toMatchObject({
      overrideAccess: false,
      draft: true,
      locale: 'en',
      data: { _status: 'draft' },
    })
    expect(options.data.layout.map((row: any) => row.id)).toEqual(['b', 'a'])
    expect(options.data.layout[1]).toMatchObject({
      heading: 'Edited',
      body,
      image: 'new',
      protectedSibling: 'Keep',
    })
    expect(options.data).not.toHaveProperty('other')
  })
  it('publishes an already saved draft without requiring new field edits', async () => {
    const { call, payload } = fixture()
    const { revision } = await (await call()).json()
    expect((await call({ action: 'publish', revision, changes: [], orders: [] })).status).toBe(200)
    expect(payload.update.mock.calls[0][0]).toMatchObject({
      draft: false,
      data: { _status: 'published' },
    })
  })
  it('rejects stale snapshots without writing', async () => {
    const { call, payload, latest } = fixture()
    const { revision } = await (await call()).json()
    latest.updatedAt = 'changed'
    expect((await call({ action: 'publish', revision, changes: [], orders: [] })).status).toBe(409)
    expect(payload.update).not.toHaveBeenCalled()
  })
  it.each([
    ['a', 'a'],
    ['a', 'unknown'],
    ['a', 'b', 'extra'],
  ])('rejects invalid block permutations %j', async (...ids) => {
    const { call, payload } = fixture()
    const { revision } = await (await call()).json()
    expect(
      (await call({ action: 'save', revision, changes: [], orders: [{ path: 'layout', ids }] }))
        .status,
    ).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
    expect(killTransaction).toHaveBeenCalled()
  })
  it('enforces authentication, allowlists, locale and safe paths', async () => {
    const { call } = fixture()
    expect((await call({}, null)).status).toBe(401)
    expect((await call({ collection: 'users' })).status).toBe(403)
    expect((await call({ locale: 'xx' })).status).toBe(400)
    expect((await call({ paths: ['__proto__.bad'] })).status).toBe(400)
  })
  it('excludes read-only fields and rejects forged edits and structural metadata', async () => {
    const { call, text, payload } = fixture()
    text.admin = { readOnly: true }
    const snapshot = await (await call()).json()
    expect(snapshot.fields).not.toHaveProperty('layout.0.heading')
    for (const path of ['layout.0.heading', 'layout.0.id', '_status']) {
      expect(
        (
          await call({
            action: 'save',
            revision: snapshot.revision,
            changes: [{ path, value: 'bad' }],
            orders: [],
          })
        ).status,
      ).toBe(400)
    }
    expect(payload.update).not.toHaveBeenCalled()
  })
  it('checks parent access for block movements', async () => {
    const { call, block, payload } = fixture()
    const { revision } = await (await call()).json()
    block.access = { update: () => false }
    expect(
      (
        await call({
          action: 'save',
          revision,
          changes: [],
          orders: [{ path: 'layout', ids: ['b', 'a'] }],
        })
      ).status,
    ).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })
  it('validates proposed values against field update access', async () => {
    const { call, text, payload } = fixture()
    const { revision } = await (await call()).json()
    text.access = { update: ({ data }: any) => data.layout[0].heading !== 'Forbidden' }
    expect(
      (
        await call({
          action: 'save',
          revision,
          changes: [{ path: 'layout.0.heading', value: 'Forbidden' }],
          orders: [],
        })
      ).status,
    ).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })
  it('rejects inaccessible media without saving the other changes', async () => {
    const { call, payload } = fixture()
    const { revision } = await (await call()).json()
    payload.find.mockResolvedValueOnce({ docs: [] })
    expect(
      (
        await call({
          action: 'publish',
          revision,
          changes: [
            { path: 'layout.0.heading', value: 'Edited' },
            { path: 'layout.0.image', value: 'missing' },
          ],
          orders: [],
        })
      ).status,
    ).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })
})

describe('relationship array editing', () => {
  function arrayFixture() {
    const fixtureData = fixture()
    const { block, doc, payload } = fixtureData
    block.blocks[0].fields.push({
      name: 'slides',
      type: 'array',
      minRows: 1,
      maxRows: 3,
      custom: { visualEditorRelationship: 'product' },
      fields: [
        { name: 'product', type: 'relationship', relationTo: 'products' },
        { name: 'caption', type: 'text' },
      ],
    })
    ;(doc.layout[0] as any).slides = [
      { id: 'one', product: 'new', caption: 'Keep me' },
      { id: 'two', product: 'new', caption: 'Remove me' },
    ]
    payload.config.collections.push({ slug: 'products', admin: { useAsTitle: 'title' } } as any)
    const paths = ['layout.0.slides', 'layout.0.slides.0.caption']
    const read = async () => (await fixtureData.call({ paths })).json()
    const save = (revision: string, value: unknown, extra: any[] = []) =>
      fixtureData.call({
        action: 'save',
        paths,
        revision,
        changes: [{ path: paths[0], value }, ...extra],
        orders: [{ path: 'layout', ids: ['b', 'a'] }],
      })
    return { ...fixtureData, read, save }
  }
  it('adds and removes rows while preserving edited overrides through block reordering', async () => {
    const { read, save, payload } = arrayFixture()
    const { revision, fields } = await read()
    expect(fields['layout.0.slides'].value).toEqual([{ id: 'one' }, { id: 'two' }])
    const response = await save(
      revision,
      [{ relationship: 'new' }, { id: 'one' }],
      [{ path: 'layout.0.slides.0.caption', value: 'Edited override' }],
    )
    expect(await response.json()).toEqual({ success: true })
    expect(payload.update.mock.calls[0][0].data.layout[1].slides).toEqual([
      { product: 'new' },
      { id: 'one', product: 'new', caption: 'Edited override' },
    ])
    expect(payload.find).toHaveBeenCalledWith(
      expect.objectContaining({ collection: 'products', overrideAccess: false }),
    )
  })
  it.each([
    [],
    [{ id: 'missing' }],
    [{ id: 'one' }, { id: 'one' }],
    [{ relationship: 'inaccessible' }],
    [{ id: 'one', caption: 'Injected' }],
    Array.from({ length: 4 }, () => ({ relationship: 'new' })),
  ])('rejects invalid array operations: %j', async (...args) => {
    // it.each spreads array cases; reconstruct the proposed row list.
    const { read, save, payload } = arrayFixture()
    const { revision } = await read()
    expect((await save(revision, args)).status).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })
  it('requires explicit schema opt-in and field access', async () => {
    const { block, read } = arrayFixture()
    const array = block.blocks[0].fields.at(-1)
    array.access = { update: () => false }
    expect((await read()).fields).not.toHaveProperty('layout.0.slides')
    delete array.access
    delete array.custom
    expect((await read()).fields).not.toHaveProperty('layout.0.slides')
  })
})
