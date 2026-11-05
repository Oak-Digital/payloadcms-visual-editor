// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
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

describe('rich-text endpoint', () => {
  it('saves a structured field, preserving siblings, through normal draft access and hooks', async () => {
    const { call, payload, doc } = fixture()
    const snapshot = await (await call()).json()
    expect(snapshot.schemaPath).toBe('collection.pages.layout.paragraph.body')
    const changed = structuredClone(value)
    changed.root.children[0].children[0].text = 'Edited'
    expect(
      (await call({ action: 'save', value: changed, revision: snapshot.revision })).status,
    ).toBe(200)
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        overrideAccess: false,
        locale: 'en',
        draft: true,
        data: { _status: 'draft', layout: [{ ...doc.layout[0], body: changed }, doc.layout[1]] },
      }),
    )
    expect(commitTransaction).toHaveBeenCalled()
  })
  it('publishes using the normal update operation', async () => {
    const { call, payload } = fixture()
    const snapshot = await (await call()).json()
    expect((await call({ action: 'publish', value, revision: snapshot.revision })).status).toBe(200)
    expect(payload.update).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: false,
        overrideAccess: false,
        data: expect.objectContaining({ _status: 'published' }),
      }),
    )
  })
  it('rejects stale versions including changes outside the edited field', async () => {
    const { call, payload, latest } = fixture()
    const snapshot = await (await call()).json()
    latest.version.layout[0].sibling = 'Concurrent edit'
    expect((await call({ action: 'save', value, revision: snapshot.revision })).status).toBe(409)
    expect(payload.update).not.toHaveBeenCalled()
    expect(killTransaction).toHaveBeenCalled()
  })
  it('reports transaction write conflicts as stale edits', async () => {
    const { call, payload } = fixture()
    const snapshot = await (await call()).json()
    payload.db.updateVersion.mockRejectedValueOnce(
      Object.assign(new Error('Write conflict'), { code: 112 }),
    )
    const response = await call({ action: 'save', value, revision: snapshot.revision })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('This document changed')
    expect(payload.update).not.toHaveBeenCalled()
  })
  it('rolls back failed validation and unsupported nodes', async () => {
    const { call, payload } = fixture()
    const snapshot = await (await call()).json()
    expect(
      (
        await call({
          action: 'save',
          revision: snapshot.revision,
          value: { root: { ...value.root, children: [{ type: 'unknown', version: 1 }] } },
        })
      ).status,
    ).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
    payload.update.mockRejectedValueOnce(new Error('Validation failed'))
    expect((await call({ action: 'publish', revision: snapshot.revision, value })).status).toBe(400)
    expect(killTransaction).toHaveBeenCalled()
  })
  it('rejects anonymous, disallowed collections, invalid locales and non-rich-text paths', async () => {
    const { call, payload } = fixture()
    expect((await call({}, null)).status).toBe(401)
    expect((await call({ collection: 'users' })).status).toBe(403)
    for (const body of [
      { locale: 'all' },
      { locale: undefined },
      { path: 'layout.0.sibling' },
      { path: '__proto__.body' },
    ])
      expect((await call(body)).status).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })
  it('rejects collection and field access denials', async () => {
    const { call, payload, collection, field } = fixture()
    collection.access.update.mockReturnValueOnce(false)
    expect((await call()).status).toBe(400)
    Object.assign(field, { access: { update: () => false } })
    expect((await call()).status).toBe(400)
    expect(payload.update).not.toHaveBeenCalled()
  })
})
