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
      find: vi
        .fn()
        .mockResolvedValue({
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
  it('rejects anonymous browsing before any document read', async () => {
    const { req } = fixture()
    expect((await handler({ ...req, user: null } as never)).status).toBe(401)
    expect(req.payload.findByID).not.toHaveBeenCalled()
  })
  it('rejects collection and ancestor field access denial', async () => {
    const { req, update, fieldUpdate } = fixture()
    update.mockResolvedValue(false)
    expect((await handler(req as never)).status).toBe(403)
    update.mockResolvedValue(true)
    fieldUpdate.mockResolvedValue(false)
    expect((await handler(req as never)).status).toBe(400)
    expect(req.payload.find).not.toHaveBeenCalled()
  })
  it('checks query-based update permissions against this document', async () => {
    const { req, update } = fixture()
    update.mockResolvedValue({ owner: { equals: 'editor' } })
    req.payload.find.mockResolvedValue({ docs: [], page: 1, totalPages: 0 })
    expect((await handler(req as never)).status).toBe(403)
    expect(req.payload.findByID).not.toHaveBeenCalled()
  })
})
