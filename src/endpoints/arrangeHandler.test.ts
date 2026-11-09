// @vitest-environment node
import { createHash } from 'node:crypto'
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
function fixture(enabled: Record<string, true> = { pages: true }) {
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
  const handler = createArrangeHandler(enabled)
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
  it('prepares editable new blocks without writing, then saves their edits at reordered positions', async () => {
    const { call, payload } = fixture()
    const id = '0123456789abcdef01234567'
    const orders = [{ path: 'layout', ids: [id, 'b'], additions: [{ id, blockType: 'section' }] }]
    const prepared = await (await call({ orders })).json()
    expect(prepared.fields['layout.2.heading']).toMatchObject({ type: 'text', value: 'section' })
    expect(prepared.fields['layout.2.body'].schemaPath).toBe('collection.pages.layout.section.body')
    expect(payload.update).not.toHaveBeenCalled()
    expect(payload.db.updateVersion).not.toHaveBeenCalled()
    const response = await call({
      action: 'save',
      revision: prepared.revision,
      orders,
      changes: [
        { path: 'layout.2.heading', value: 'Unsaved heading' },
        { path: 'layout.2.body', value: richText },
        { path: 'layout.2.image', value: 'new' },
      ],
    })
    expect(response.status).toBe(200)
    const rows = payload.update.mock.calls[0][0].data.layout
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id, heading: 'Unsaved heading', body: richText, image: 'new' })
    expect(rows[1]).toMatchObject({ id: 'b', heading: 'Second' })
  })

  it('keeps later new-block paths stable after removing an earlier unsaved block', async () => {
    const { call, payload } = fixture()
    const first = '0123456789abcdef01234567'
    const second = '0123456789abcdef01234568'
    const orders = [
      {
        path: 'layout',
        ids: ['a', second],
        additions: [
          { id: first, blockType: 'section' },
          { id: second, blockType: 'section' },
        ],
      },
    ]
    const { revision } = await (await call({ orders })).json()
    const response = await call({
      action: 'save',
      revision,
      orders,
      changes: [{ path: 'layout.3.heading', value: 'Retained' }],
    })
    expect(response.status).toBe(200)
    expect(payload.update.mock.calls[0][0].data.layout.map((row: any) => row.id)).toEqual([
      'a',
      second,
    ])
    expect(payload.update.mock.calls[0][0].data.layout[1].heading).toBe('Retained')
  })

  it('enforces new-block field access on preparation and saving', async () => {
    const { call, text, payload } = fixture()
    text.access = { update: () => false }
    const id = '0123456789abcdef01234567'
    const orders = [
      { path: 'layout', ids: ['a', 'b', id], additions: [{ id, blockType: 'section' }] },
    ]
    const prepared = await (await call({ orders })).json()
    expect(prepared.fields['layout.2.heading']).toBeUndefined()
    expect(
      (
        await call({
          action: 'save',
          revision: prepared.revision,
          orders,
          changes: [{ path: 'layout.2.heading', value: 'Forged' }],
        })
      ).status,
    ).toBe(400)
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
  it('rejects unauthorized batches, protected fields and inaccessible media without partial writes', async () => {
    const unauthorized = fixture()
    expect((await unauthorized.call({}, null)).status).toBe(401)
    expect((await unauthorized.call({ collection: 'users' })).status).toBe(403)
    expect((await unauthorized.call({ locale: 'xx' })).status).toBe(400)
    expect((await unauthorized.call({ paths: ['__proto__.bad'] })).status).toBe(400)
    expect(unauthorized.payload.update).not.toHaveBeenCalled()

    const scoped = fixture()
    scoped.collection.access.update.mockReturnValue({ owner: { equals: 'someone-else' } })
    scoped.payload.find.mockResolvedValue({ docs: [] })
    expect((await scoped.call()).status).not.toBe(200)
    expect(scoped.payload.db.findVersions).not.toHaveBeenCalled()
    expect(scoped.payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        overrideAccess: false,
        where: { and: [{ owner: { equals: 'someone-else' } }, { id: { equals: 'page' } }] },
      }),
    )

    for (const reason of ['read-only', 'metadata', 'parent access', 'proposed value', 'media']) {
      const { call, text, block, payload } = fixture()
      if (reason === 'read-only') text.admin = { readOnly: true }
      const snapshot = await (await call()).json()
      if (reason === 'read-only') expect(snapshot.fields).not.toHaveProperty('layout.0.heading')
      if (reason === 'parent access') block.access = { update: () => false }
      if (reason === 'proposed value')
        text.access = {
          update: ({ data }: any) => data.layout[0].heading !== 'Forbidden',
        }
      if (reason === 'media') payload.find.mockResolvedValueOnce({ docs: [] })
      const changes =
        reason === 'metadata'
          ? [{ path: 'layout.0.id', value: 'changed' }]
          : [
              { path: 'layout.0.heading', value: 'Forbidden' },
              ...(reason === 'media' ? [{ path: 'layout.0.image', value: 'missing' }] : []),
            ]
      expect(
        (
          await call({
            action: 'save',
            revision: snapshot.revision,
            changes: reason === 'parent access' ? [] : changes,
            orders: [{ path: 'layout', ids: ['b', 'a'] }],
          })
        ).status,
        reason,
      ).toBe(400)
      expect(payload.update).not.toHaveBeenCalled()
    }
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
  it('duplicates nested rows with independent identities and applies copied row edits before reordering', async () => {
    const { call, payload } = arrayFixture()
    const id = '0123456789abcdef01234567'
    const orders = [
      {
        path: 'layout',
        ids: ['a', id, 'b'],
        additions: [{ id, blockType: 'section', sourceId: 'a' }],
      },
    ]
    const prepared = await (await call({ orders })).json()
    const rows = prepared.fields['layout.2.slides'].value
    expect(rows[0].id).not.toBe('one')
    expect(rows[1].id).not.toBe('two')
    const saved = await call({
      action: 'save',
      revision: prepared.revision,
      orders,
      changes: [
        { path: 'layout.2.slides.0.caption', value: 'Copied pending caption' },
        { path: 'layout.2.slides', value: [rows[1], rows[0]] },
      ],
    })
    expect(saved.status).toBe(200)
    const layout = payload.update.mock.calls[0][0].data.layout
    expect(layout[0].slides[0]).toMatchObject({ id: 'one', caption: 'Keep me' })
    expect(layout[1].slides[1]).toMatchObject({
      id: rows[0].id,
      caption: 'Copied pending caption',
      product: 'new',
    })
  })
  it('rejects invalid relationship arrays without writing', async () => {
    for (const rows of [
      [],
      [{ id: 'missing' }],
      [{ id: 'one' }, { id: 'one' }],
      [{ relationship: 'inaccessible' }],
      [{ id: 'one', caption: 'Injected' }],
      Array.from({ length: 4 }, () => ({ relationship: 'new' })),
    ]) {
      const { read, save, payload } = arrayFixture()
      const { revision } = await read()
      expect((await save(revision, rows)).status, JSON.stringify(rows)).toBe(400)
      expect(payload.update).not.toHaveBeenCalled()
    }
  })
})

it('duplicates stored content independently and retains the copy after removing its source', async () => {
  const { call, payload } = fixture()
  const id = '0123456789abcdef01234567'
  const orders = [
    { path: 'layout', ids: [id, 'b'], additions: [{ id, blockType: 'section', sourceId: 'a' }] },
  ]
  const prepared = await (await call({ orders })).json()
  expect(prepared.fields['layout.2.heading'].value).toBe('First')
  expect(payload.update).not.toHaveBeenCalled()
  const saved = await call({
    action: 'save',
    revision: prepared.revision,
    orders,
    changes: [{ path: 'layout.2.heading', value: 'Independent copy' }],
  })
  expect(saved.status).toBe(200)
  expect(payload.update.mock.calls[0][0].data.layout[0]).toMatchObject({
    id,
    heading: 'Independent copy',
    image: 'old',
  })
})

it('previews pending content without saving a document or writing versions', async () => {
  const { call, payload } = fixture()
  const { revision } = await (await call()).json()
  const response = await call({
    action: 'preview',
    revision,
    changes: [{ path: 'layout.0.heading', value: 'Unsaved preview' }],
    orders: [{ path: 'layout', ids: ['b', 'a'] }],
  })
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(result.document.layout[1].heading).toBe('Unsaved preview')
  expect(result.rowPaths.a).toBe('layout.0')
  expect(payload.update).not.toHaveBeenCalled()
  expect(payload.db.updateVersion).not.toHaveBeenCalled()
  expect(payload.findByID).toHaveBeenLastCalledWith(
    expect.objectContaining({ overrideAccess: false }),
  )
})

it('offers and validates only accessible opted-in saved layout choices', async () => {
  const f = fixture({ pages: true, layouts: true })
  f.block.blocks[0].fields.push({
    name: 'source',
    type: 'relationship',
    relationTo: 'layouts',
    custom: { visualEditorLayout: 'layout' },
  })
  f.payload.config.collections.push({
    slug: 'layouts',
    admin: { useAsTitle: 'title' },
    versions: { drafts: true },
    fields: [],
  } as any)
  f.payload.find.mockResolvedValue({ docs: [{ id: 'new', title: 'Reusable' }] } as any)
  const snapshot = await (await f.call()).json()
  expect(snapshot.fields['layout.0.source']).toMatchObject({
    type: 'relationship',
    collection: 'layouts',
    choices: [{ id: 'new', label: 'Reusable' }],
  })
  const invalid = await f.call({
    action: 'save',
    revision: snapshot.revision,
    changes: [{ path: 'layout.0.source', value: 'hidden' }],
    orders: [],
  })
  expect(invalid.status).not.toBe(200)
  expect(f.payload.update).not.toHaveBeenCalled()
  const valid = await f.call({
    action: 'save',
    revision: snapshot.revision,
    changes: [{ path: 'layout.0.source', value: 'new' }],
    orders: [],
  })
  expect(valid.status).toBe(200)
  expect(f.payload.update).toHaveBeenCalled()
})

it('copies schema-owned source blocks with independent IDs and rejects changed source revisions', async () => {
  const f = fixture({ pages: true, layouts: true })
  f.block.blocks[0].fields.push({
    name: 'source',
    type: 'relationship',
    relationTo: 'layouts',
    custom: { visualEditorLayout: 'layout' },
  })
  f.payload.config.collections.push({
    slug: 'layouts',
    admin: { useAsTitle: 'title' },
    versions: { drafts: true },
    fields: [f.block],
  } as any)
  const source = {
    id: 'template',
    layout: [
      {
        id: 'source-row',
        blockType: 'section',
        heading: 'Shared heading',
        secretExtra: 'Must not copy',
      },
    ],
  }
  const sourceVersion = { id: 'source-version', version: source, latest: true }
  f.payload.findByID.mockImplementation(
    async (options: any = {}) =>
      structuredClone(options.collection === 'layouts' ? source : f.doc) as any,
  )
  f.payload.db.findVersions.mockImplementation(
    async (options: any = {}) =>
      ({ docs: [options.collection === 'layouts' ? sourceVersion : f.latest] }) as any,
  )
  const id = 'a'.repeat(24)
  const addition = {
    id,
    blockType: 'section',
    layoutSource: {
      collection: 'layouts',
      id: 'template',
      path: 'layout',
      rowId: 'source-row',
      revision: createHash('sha256').update(JSON.stringify(sourceVersion)).digest('hex'),
    },
  }
  const orders = [{ path: 'layout', ids: ['a', id, 'b'], additions: [addition] }]
  const prepared = await (await f.call({ orders })).json()
  expect(prepared.fields['layout.2.heading'].value).toBe('Shared heading')
  expect(f.payload.update).not.toHaveBeenCalled()
  const saved = await f.call({ action: 'save', revision: prepared.revision, changes: [], orders })
  expect(saved.status).toBe(200)
  const copy = f.payload.update.mock.calls[0][0].data.layout[1]
  expect(copy).toMatchObject({ id, heading: 'Shared heading' })
  expect(copy.secretExtra).toBeUndefined()
  f.payload.findByID.mockImplementation(async (options: any = {}) => {
    if (options.collection === 'layouts') throw new Error('Access denied')
    return structuredClone(f.doc)
  })
  expect((await f.call({ orders })).status).not.toBe(200)
  f.payload.findByID.mockImplementation(
    async (options: any = {}) =>
      structuredClone(options.collection === 'layouts' ? source : f.doc) as any,
  )
  f.text.access = { update: () => false }
  expect((await f.call({ orders })).status).not.toBe(200)
  delete f.text.access
  sourceVersion.version.layout[0].heading = 'New source'
  const stale = await f.call({ orders })
  expect(stale.status).not.toBe(200)
  expect((await stale.json()).error).toContain('shared layout changed')
})

it('reviews without writing, publishes saved drafts and refuses stale snapshots', async () => {
  const f = fixture()
  f.collection.admin = { useAsTitle: 'other' }
  const published = structuredClone(f.doc)
  published.layout[0].heading = 'Published heading'
  f.payload.find.mockResolvedValue({ docs: [published] } as any)
  const { revision } = await (await f.call()).json()
  const result = await f.call({
    action: 'review',
    revision,
    changes: [{ path: 'layout.1.heading', value: 'Pending heading' }],
    orders: [],
  })
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({
    revision,
    published: true,
    changes: expect.arrayContaining([
      { path: 'layout.0.heading', before: 'Published heading', after: 'First' },
      { path: 'layout.1.heading', before: 'Second', after: 'Pending heading' },
    ]),
  })
  expect(f.payload.find).toHaveBeenCalledWith(
    expect.objectContaining({ draft: false, overrideAccess: false, locale: 'en' }),
  )
  expect(f.payload.update).not.toHaveBeenCalled()
  expect(f.payload.db.updateVersion).not.toHaveBeenCalled()
  expect((await f.call({ action: 'publish', revision, changes: [], orders: [] })).status).toBe(200)
  expect(f.payload.update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      draft: false,
      data: expect.objectContaining({ _status: 'published' }),
    }),
  )
  f.payload.update.mockClear()
  f.latest.updatedAt = 'newer'
  for (const action of ['review', 'publish']) {
    expect((await f.call({ action, revision, changes: [], orders: [] })).status, action).toBe(409)
  }
  expect(f.payload.update).not.toHaveBeenCalled()
})

it('returns individual validation messages when publication fails and rolls back', async () => {
  vi.mocked(killTransaction).mockClear()
  const f = fixture()
  const { revision } = await (await f.call()).json()
  const fieldErrors = [
    {
      path: 'layout.0.heading',
      label: 'Content > Layout > Block 1 (Introduction) > Heading',
      message: 'This field is required.',
    },
  ]
  f.payload.update.mockRejectedValueOnce(
    Object.assign(new Error('Long validation summary'), {
      name: 'ValidationError',
      data: { errors: fieldErrors },
    }),
  )
  const response = await f.call({ action: 'publish', revision, changes: [], orders: [] })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ fieldErrors })
  expect(killTransaction).toHaveBeenCalled()
})

function controlsFixture() {
  const f = fixture()
  f.block.blocks[0].fields.push(
    { name: 'order', type: 'radio', label: 'Order', options: ['image-left', 'image-right'] },
    { name: 'addLink', type: 'checkbox', label: 'Add Link' },
    {
      type: 'collapsible',
      label: 'Link',
      admin: { condition: (_: unknown, sibling: any) => sibling.addLink === true },
      fields: [
        {
          name: 'link',
          type: 'group',
          fields: [
            { name: 'type', type: 'radio', options: ['reference', 'custom'] },
            { name: 'label', type: 'text' },
            {
              name: 'url',
              type: 'text',
              admin: { condition: (_: unknown, sibling: any) => sibling.type === 'custom' },
            },
            {
              name: 'relation',
              type: 'relationship',
              relationTo: ['pages'],
              admin: { condition: (_: unknown, sibling: any) => sibling.type === 'reference' },
            },
            { name: 'openNewTab', type: 'checkbox' },
          ],
        },
      ],
    },
  )
  Object.assign(f.doc.layout[0], { order: 'image-left', addLink: false })
  return f
}

describe('block controls and conditional fields', () => {
  it('discovers controls and absent optional groups without exposing protected fields', async () => {
    const f = controlsFixture()
    f.block.blocks[0].fields.push({
      name: 'secret',
      type: 'checkbox',
      access: { read: () => false },
    })
    const snapshot = await (await f.call()).json()
    expect(snapshot.fields['layout.0.order']).toMatchObject({
      type: 'radio',
      value: 'image-left',
      hidden: false,
    })
    expect(snapshot.fields['layout.0.addLink']).toMatchObject({
      type: 'checkbox',
      value: false,
      label: 'Add Link',
    })
    expect(snapshot.fields['layout.0.link.url']).toMatchObject({
      type: 'text',
      hidden: true,
      conditional: true,
    })
    expect(snapshot.fields['layout.0.link.relation']).toMatchObject({
      type: 'reference',
      hidden: true,
    })
    expect(snapshot.fields['layout.0.secret']).toBeUndefined()
  })

  it('reevaluates ancestor and sibling conditions on pending data without writing', async () => {
    const f = controlsFixture()
    const { revision } = await (await f.call()).json()
    const changes = [
      { path: 'layout.0.addLink', value: true },
      { path: 'layout.0.link.type', value: 'custom' },
    ]
    const response = await f.call({ action: 'fields', revision, changes, orders: [] })
    expect(response.status).toBe(200)
    const { presentation } = await response.json()
    expect(presentation['layout.0.link.url'].hidden).toBe(false)
    expect(presentation['layout.0.link.relation'].hidden).toBe(true)
    changes[1].value = 'reference' as any
    const reference = await (
      await f.call({ action: 'fields', revision, changes, orders: [] })
    ).json()
    expect(reference.presentation['layout.0.link.url'].hidden).toBe(true)
    expect(reference.presentation['layout.0.link.relation'].hidden).toBe(false)
    expect(f.payload.update).not.toHaveBeenCalled()
    expect(f.payload.db.updateVersion).not.toHaveBeenCalled()
  })

  it('saves controls and conditional link values together at stable paths before moving blocks', async () => {
    const f = controlsFixture()
    const { revision } = await (await f.call()).json()
    const response = await f.call({
      action: 'save',
      revision,
      changes: [
        { path: 'layout.0.link.url', value: 'https://example.com' },
        { path: 'layout.0.link.type', value: 'custom' },
        { path: 'layout.0.addLink', value: true },
        { path: 'layout.0.order', value: 'image-right' },
        { path: 'layout.0.link.openNewTab', value: true },
      ],
      orders: [{ path: 'layout', ids: ['b', 'a'] }],
    })
    expect(response.status).toBe(200)
    expect(f.payload.update.mock.calls[0][0].data.layout[1]).toMatchObject({
      id: 'a',
      order: 'image-right',
      addLink: true,
      link: { type: 'custom', url: 'https://example.com', openNewTab: true },
    })
  })

  it.each([
    ['layout.0.order', 'invalid'],
    ['layout.0.addLink', 'true'],
    ['layout.0.link.relation', { relationTo: 'users', value: 'new' }],
  ])('rejects invalid values for %s', async (path, value) => {
    const f = controlsFixture()
    const { revision } = await (await f.call()).json()
    const response = await f.call({
      action: 'save',
      revision,
      changes: [{ path, value }],
      orders: [],
    })
    expect(response.status).toBe(400)
    expect(f.payload.update).not.toHaveBeenCalled()
  })

  it('checks relationship filters and access on the proposed document', async () => {
    const f = controlsFixture()
    const group = f.block.blocks[0].fields.at(-1).fields[0]
    const relation = group.fields.find((field: any) => field.name === 'relation')
    relation.filterOptions = vi.fn(({ siblingData }) => ({ title: { equals: siblingData.label } }))
    const { revision } = await (await f.call()).json()
    f.payload.find.mockResolvedValue({ docs: [] })
    const response = await f.call({
      action: 'save',
      revision,
      changes: [
        { path: 'layout.0.link.label', value: 'Allowed title' },
        { path: 'layout.0.link.relation', value: { relationTo: 'pages', value: 'new' } },
      ],
      orders: [],
    })
    expect(response.status).toBe(400)
    expect(relation.filterOptions).toHaveBeenLastCalledWith(
      expect.objectContaining({ siblingData: expect.objectContaining({ label: 'Allowed title' }) }),
    )
    expect(f.payload.find).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overrideAccess: false,
        where: { and: [{ title: { equals: 'Allowed title' } }, { id: { equals: 'new' } }] },
      }),
    )
    expect(f.payload.update).not.toHaveBeenCalled()
  })
})

it('keeps different block schemas isolated and saves multi-select edits at original paths after reordering', async () => {
  const f = fixture()
  f.block.blocks.push({
    slug: 'intro',
    fields: [
      { type: 'collapsible', label: 'Statement', fields: [{ name: 'heading', type: 'text' }] },
      {
        type: 'group',
        name: 'press',
        fields: [
          { name: 'publications', type: 'select', hasMany: true, options: ['forbes', 'dr'] },
        ],
      },
    ],
  })
  Object.assign(f.doc.layout[1], { blockType: 'intro', press: { publications: ['forbes'] } })
  const read = await (await f.call()).json()
  expect(read.fields['layout.1.press.publications']).toMatchObject({
    hasMany: true,
    value: ['forbes'],
  })
  expect(read.fields['layout.1.body']).toBeUndefined()
  expect(read.fields['layout.1.image']).toBeUndefined()
  const orders = [{ path: 'layout', ids: ['b', 'a'] }]
  const changes = [{ path: 'layout.1.press.publications', value: ['dr', 'forbes'] }]
  for (const value of [['unknown'], 'dr', ['dr', 'dr']]) {
    expect(
      (
        await f.call({
          action: 'save',
          revision: read.revision,
          orders,
          changes: [{ ...changes[0], value }],
        })
      ).status,
    ).toBe(400)
  }
  expect(f.payload.update).not.toHaveBeenCalled()
  const saved = await f.call({ action: 'save', revision: read.revision, orders, changes })
  expect(saved.status).toBe(200)
  expect(f.payload.update.mock.calls[0][0].data.layout[0]).toMatchObject({
    id: 'b',
    blockType: 'intro',
    press: { publications: ['dr', 'forbes'] },
  })
  expect(f.payload.update.mock.calls[0][0].data.layout[1]).toMatchObject({
    id: 'a',
    heading: 'First',
  })
})
