// @vitest-environment node
import { expect, it, vi } from 'vitest'
vi.mock('payload', () => ({
  initTransaction: vi.fn(async () => true),
  commitTransaction: vi.fn(),
  killTransaction: vi.fn(),
}))
import { commitTransaction, killTransaction } from 'payload'
import { createRichTextHandler } from './richTextHandler.js'

const value = {
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
  const field = {
    name: 'body',
    type: 'richText',
    editor: { editorConfig: { features: { nodes: [] } } },
  }
  const doc = {
    id: 'page',
    layout: [
      { blockType: 'paragraph', id: 'row', body: value, sibling: 'Keep' },
      { blockType: 'paragraph', id: 'other', body: value },
    ],
  }
  const collection = {
    slug: 'pages',
    versions: { drafts: true },
    access: { update: vi.fn(() => true) },
    fields: [
      {
        type: 'blocks',
        name: 'layout',
        blocks: [{ slug: 'paragraph', fields: [field, { name: 'sibling', type: 'text' }] }],
      },
    ],
  }
  const latest = { id: 'version', version: doc, updatedAt: '2026-01-01', latest: true }
  const payload = {
    config: { localization: { localeCodes: ['en', 'da'] }, collections: [collection] },
    findByID: vi.fn(async () => structuredClone(doc)),
    update: vi.fn(async (options: any) => ({ ...doc, _status: options.data._status })),
    db: { findVersions: vi.fn(async () => ({ docs: [latest] })), updateVersion: vi.fn() },
    logger: { error: vi.fn() },
  }
  const handler = createRichTextHandler({ pages: true })
  const base = {
    id: 'page',
    collection: 'pages',
    locale: 'en',
    path: 'layout.0.body',
    action: 'read',
  }
  const call = (body = {}, user: object | null = { id: 'editor' }) =>
    handler({ payload, user, json: async () => ({ ...base, ...body }) } as never)
  return { call, payload, collection, field, doc, latest }
}

it('saves and publishes structured content through Payload while preserving sibling fields', async () => {
  const { call, payload, doc } = fixture()
  const { revision, schemaPath } = await (await call()).json()
  expect(schemaPath).toBe('collection.pages.layout.paragraph.body')
  const changed = structuredClone(value)
  changed.root.children[0].children[0].text = 'Edited'
  for (const action of ['save', 'publish']) {
    expect((await call({ action, value: changed, revision })).status, action).toBe(200)
    expect(payload.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        overrideAccess: false,
        locale: 'en',
        draft: action === 'save',
        data: {
          _status: action === 'save' ? 'draft' : 'published',
          layout: [{ ...doc.layout[0], body: changed }, doc.layout[1]],
        },
      }),
    )
  }
  expect(commitTransaction).toHaveBeenCalled()
})

it('rejects inaccessible rich-text fields and out-of-scope requests', async () => {
  const { call, payload, collection, field } = fixture()
  expect((await call({}, null)).status).toBe(401)
  expect((await call({ collection: 'users' })).status).toBe(403)
  for (const body of [
    { locale: 'all' },
    { path: 'layout.0.sibling' },
    { path: '__proto__.body' },
  ]) {
    expect((await call(body)).status, JSON.stringify(body)).toBe(400)
  }
  collection.access.update.mockReturnValueOnce(false)
  expect((await call()).status).toBe(400)
  Object.assign(field, { access: { update: () => false } })
  expect((await call()).status).toBe(400)
  expect(payload.update).not.toHaveBeenCalled()
})

it('rejects stale edits and rolls back conflicts or invalid rich-text writes', async () => {
  for (const reason of ['stale', 'conflict', 'unknown node', 'validation']) {
    vi.mocked(killTransaction).mockClear()
    const { call, payload, latest } = fixture()
    const { revision } = await (await call()).json()
    if (reason === 'stale') latest.version.layout[0].sibling = 'Concurrent edit'
    if (reason === 'conflict')
      payload.db.updateVersion.mockRejectedValueOnce(
        Object.assign(new Error('Write conflict'), { code: 112 }),
      )
    if (reason === 'validation')
      payload.update.mockRejectedValueOnce(new Error('Validation failed'))
    const proposed =
      reason === 'unknown node'
        ? { root: { ...value.root, children: [{ type: 'unknown', version: 1 }] } }
        : value
    const response = await call({ action: 'save', revision, value: proposed })
    expect(response.status, reason).toBe(['stale', 'conflict'].includes(reason) ? 409 : 400)
    if (reason !== 'validation') expect(payload.update).not.toHaveBeenCalled()
    expect(killTransaction, reason).toHaveBeenCalled()
  }
})
