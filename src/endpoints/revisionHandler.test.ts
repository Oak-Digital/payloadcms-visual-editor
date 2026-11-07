// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
vi.mock('payload', () => ({
  initTransaction: vi.fn(async () => true),
  commitTransaction: vi.fn(),
  killTransaction: vi.fn(),
}))
import { createRevisionHandler } from './revisionHandler.js'

function fixture() {
  const heading: any = { name: 'heading', type: 'text' }
  const fields: any[] = [
    { name: 'title', type: 'text', localized: true },
    { name: 'slug', type: 'text', localized: true },
    {
      name: 'meta',
      type: 'group',
      fields: [
        { name: 'description', type: 'text' },
        { name: 'image', type: 'upload', relationTo: 'media' },
      ],
    },
    {
      name: 'layout',
      type: 'blocks',
      localized: true,
      blocks: [{ slug: 'paragraph', fields: [heading] }],
    },
    { name: '_status', type: 'select', options: ['draft', 'published'] },
  ]
  const current: any = {
    id: 'page',
    title: 'Current',
    slug: 'current',
    _status: 'published',
    meta: { description: 'New', image: 'new-image' },
    layout: [{ id: 'row', blockType: 'paragraph', heading: 'Current' }],
  }
  const historical: any = {
    id: 'page',
    title: 'Old',
    slug: 'old',
    _status: 'published',
    meta: { description: 'Old' },
    layout: [{ id: 'row', blockType: 'paragraph', heading: 'Old' }],
  }
  const version = {
    id: 'old-version',
    parent: 'page',
    version: historical,
    updatedAt: '2026-01-01',
  }
  const latest = {
    id: 'current-version',
    parent: 'page',
    version: current,
    updatedAt: '2026-02-01',
    latest: true,
  }
  const collection: any = {
    slug: 'pages',
    versions: { drafts: true },
    access: { update: vi.fn(() => true) },
    fields,
  }
  const payload: any = {
    config: { localization: { localeCodes: ['en', 'da'] }, collections: [collection] },
    findByID: vi.fn(async () => structuredClone(current)),
    findVersionByID: vi.fn(async () => structuredClone(version)),
    find: vi.fn(async () => ({ docs: [current] })),
    update: vi.fn(async (args: any) => ({ id: 'page', ...args.data })),
    db: { findVersions: vi.fn(async () => ({ docs: [latest] })), updateVersion: vi.fn() },
  }
  const req: any = { user: { id: 'editor' }, payload }
  const handler = createRevisionHandler({ pages: true })
  const revision = createHash('sha256').update(JSON.stringify(latest)).digest('hex')
  const call = (body: object = {}) => {
    req.json = async () => ({
      action: 'preview',
      collection: 'pages',
      id: 'page',
      versionId: 'old-version',
      locale: 'da',
      ...body,
    })
    return handler(req)
  }
  return { req, payload, call, heading, collection, version, revision, latest }
}
it('previews only authorized historical content without writing versions', async () => {
  const f = fixture()
  const response = await f.call()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ document: { title: 'Old' }, revision: f.revision })
  expect(f.payload.findVersionByID).toHaveBeenCalledWith(
    expect.objectContaining({ overrideAccess: false, locale: 'da', fallbackLocale: false }),
  )
  expect(f.payload.update).not.toHaveBeenCalled()
  expect(f.payload.db.updateVersion).not.toHaveBeenCalled()
})
it('restores selected-locale fields as a new draft, clearing removed properties', async () => {
  const f = fixture()
  expect((await f.call({ action: 'restore', revision: f.revision })).status).toBe(200)
  expect(f.payload.update).toHaveBeenCalledWith(
    expect.objectContaining({
      id: 'page',
      locale: 'da',
      fallbackLocale: false,
      draft: true,
      overrideAccess: false,
      data: {
        title: 'Old',
        slug: 'old',
        meta: { description: 'Old', image: null },
        layout: [{ id: 'row', blockType: 'paragraph', heading: 'Old' }],
        _status: 'draft',
      },
    }),
  )
  expect(f.payload.db.updateVersion).toHaveBeenCalledTimes(2)
})
it('rejects stale restoration before any writes', async () => {
  const f = fixture()
  expect((await f.call({ action: 'restore', revision: 'stale' })).status).toBe(409)
  expect(f.payload.update).not.toHaveBeenCalled()
  expect(f.payload.db.updateVersion).not.toHaveBeenCalled()
})
it('rejects revisions from another document and denied version access', async () => {
  const f = fixture()
  f.version.parent = 'other'
  expect((await f.call()).status).not.toBe(200)
  f.payload.findVersionByID.mockRejectedValue(new Error('Version access denied'))
  expect((await f.call()).status).not.toBe(200)
  expect(f.payload.update).not.toHaveBeenCalled()
})
it('checks query-scoped update access and changed protected nested fields', async () => {
  const f = fixture()
  f.collection.access.update.mockReturnValue({ owner: { equals: 'other' } })
  f.payload.find.mockResolvedValue({ docs: [] })
  expect((await f.call()).status).not.toBe(200)
  expect(f.payload.findVersionByID).not.toHaveBeenCalled()
  f.collection.access.update.mockReturnValue(true)
  f.heading.access = { update: () => false }
  expect((await f.call({ action: 'restore', revision: f.revision })).status).not.toBe(200)
  expect(f.payload.update).not.toHaveBeenCalled()
})
it('rejects anonymous users, disabled collections and invalid locales', async () => {
  const f = fixture()
  expect((await f.call({ locale: 'unconfigured' })).status).not.toBe(200)
  expect((await f.call({ collection: 'other' })).status).toBe(403)
  f.req.user = null
  expect((await f.call()).status).toBe(401)
  expect(f.payload.findByID).not.toHaveBeenCalled()
})
