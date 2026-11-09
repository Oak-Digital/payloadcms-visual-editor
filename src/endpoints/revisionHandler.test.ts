// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
vi.mock('payload', () => ({
  initTransaction: vi.fn(async () => true),
  commitTransaction: vi.fn(),
  killTransaction: vi.fn(),
}))
import { killTransaction } from 'payload'
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
it('previews without writes, rejects stale restoration and restores only the selected locale as a draft', async () => {
  const f = fixture()
  const response = await f.call()
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ document: { title: 'Old' }, revision: f.revision })
  expect(f.payload.findVersionByID).toHaveBeenCalledWith(
    expect.objectContaining({
      overrideAccess: false,
      locale: 'da',
      fallbackLocale: false,
    }),
  )
  expect(f.payload.update).not.toHaveBeenCalled()
  expect(f.payload.db.updateVersion).not.toHaveBeenCalled()
  expect((await f.call({ action: 'restore', revision: 'stale' })).status).toBe(409)
  expect(f.payload.update).not.toHaveBeenCalled()
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

it('refuses unauthorized history and restoration of protected fields', async () => {
  for (const reason of [
    'anonymous',
    'collection',
    'locale',
    'other document',
    'version access',
    'query',
    'field',
  ]) {
    vi.mocked(killTransaction).mockClear()
    const f = fixture()
    if (reason === 'anonymous') f.req.user = null
    if (reason === 'other document') f.version.parent = 'other'
    if (reason === 'version access')
      f.payload.findVersionByID.mockRejectedValue(new Error('Denied'))
    if (reason === 'query') {
      f.collection.access.update.mockReturnValue({ owner: { equals: 'other' } })
      f.payload.find.mockResolvedValue({ docs: [] })
    }
    if (reason === 'field') f.heading.access = { update: () => false }
    const response = await f.call({
      action: 'restore',
      revision: f.revision,
      ...(reason === 'collection' ? { collection: 'other' } : {}),
      ...(reason === 'locale' ? { locale: 'unconfigured' } : {}),
    })
    expect(response.status, reason).toBe(
      reason === 'anonymous' ? 401 : reason === 'collection' ? 403 : 400,
    )
    expect(f.payload.update).not.toHaveBeenCalled()
    if (reason === 'field') expect(killTransaction).toHaveBeenCalled()
    else expect(f.payload.db.updateVersion).not.toHaveBeenCalled()
  }
})
