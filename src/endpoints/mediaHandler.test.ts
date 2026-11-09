import { describe, expect, it, vi } from 'vitest'
import { createMediaHandler } from './mediaHandler.js'

function fixture() {
  const update = vi.fn().mockResolvedValue(true)
  const create = vi.fn().mockResolvedValue(false)
  const fieldUpdate = vi.fn().mockResolvedValue(true)
  const req = {
    user: { id: 'editor' },
    json: async () => ({
      id: 'page',
      collection: 'pages',
      locale: 'en',
      path: 'image',
      page: 2,
      search: 'watch',
    }),
    payload: {
      config: {
        localization: { localeCodes: ['en'] },
        routes: { api: '/cms-api' },
        collections: [
          {
            slug: 'pages',
            access: { update },
            versions: { drafts: true },
            fields: [
              {
                type: 'upload',
                name: 'image',
                relationTo: 'photos',
                access: { update: fieldUpdate },
              },
            ],
          },
          { slug: 'photos', access: { create }, upload: { mimeTypes: ['image/png'] } },
        ],
      },
      findByID: vi.fn().mockResolvedValue({ id: 'page', image: 'old' }),
      find: vi.fn().mockResolvedValue({
        docs: [{ id: 'photo', url: '/photo.png', filename: 'watch.png' }],
        page: 2,
        totalPages: 3,
      }),
      logger: { error: vi.fn() },
    },
  }
  return { req, update, create, fieldUpdate }
}
const handler = createMediaHandler({ pages: true })
describe('media browsing permissions', () => {
  it('derives collection and restrictions and paginates with read access', async () => {
    const { req } = fixture()
    const response = await handler(req as never)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      collection: 'photos',
      canUpload: false,
      page: 2,
      totalPages: 3,
    })
    expect(req.payload.find).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: 'photos',
        page: 2,
        limit: 20,
        overrideAccess: false,
        req,
        where: {
          and: [
            {
              and: [
                { mimeType: { contains: 'image/' } },
                { or: [{ mimeType: { equals: 'image/png' } }] },
              ],
            },
            { filename: { contains: 'watch' } },
          ],
        },
      }),
    )
  })
  it('rejects anonymous, collection, ancestor-field and query-scoped access before browsing', async () => {
    for (const reason of ['anonymous', 'collection', 'field', 'query']) {
      const f = fixture()
      if (reason === 'collection') f.update.mockResolvedValue(false)
      if (reason === 'field') f.fieldUpdate.mockResolvedValue(false)
      if (reason === 'query') {
        f.update.mockResolvedValue({ owner: { equals: 'editor' } })
        f.req.payload.find.mockResolvedValue({ docs: [], page: 1, totalPages: 0 })
      }
      const req = reason === 'anonymous' ? { ...f.req, user: null } : f.req
      expect((await handler(req as never)).status, reason).toBe(
        reason === 'anonymous' ? 401 : reason === 'field' ? 400 : 403,
      )
      if (reason === 'query') expect(f.req.payload.findByID).not.toHaveBeenCalled()
      else expect(f.req.payload.find).not.toHaveBeenCalled()
    }
  })
})
