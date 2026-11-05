import { describe, expect, it, vi } from 'vitest'
import { createVisualEditorMutationHandler } from './visualEditorMutationHandler.js'

const handler = createVisualEditorMutationHandler({ pages: true })
function fixture(value: string | number | null = 'new', action = 'save') {
  const doc = {
    id: 'page',
    layout: [{ blockType: 'hero', id: 'row', image: 'old', title: 'Keep' }],
  }
  const fieldUpdate = vi.fn().mockResolvedValue(true)
  const filterOptions = vi.fn().mockResolvedValue({ approved: { equals: true } })
  const update = vi.fn().mockResolvedValue({ id: 'page' })
  const req = {
    user: { id: 'editor' },
    json: async () => ({
      id: 'page',
      collection: 'pages',
      action,
      locale: 'en',
      patches: [{ path: 'layout.0.image', value }],
    }),
    payload: {
      config: {
        localization: { localeCodes: ['en'] },
        collections: [
          {
            slug: 'pages',
            versions: { drafts: true },
            fields: [
              {
                type: 'blocks',
                name: 'layout',
                blocks: [
                  {
                    slug: 'hero',
                    fields: [
                      {
                        type: 'upload',
                        name: 'image',
                        relationTo: 'assets',
                        required: true,
                        filterOptions,
                        access: { update: fieldUpdate },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { slug: 'assets', upload: { mimeTypes: ['image/png'] } },
        ],
      },
      findByID: vi.fn().mockResolvedValue(doc),
      find: vi.fn().mockResolvedValue({ docs: [{ id: value, mimeType: 'image/png' }] }),
      update,
      logger: { error: vi.fn() },
    },
  }
  return { req, update, fieldUpdate, filterOptions }
}
describe('media replacement mutations', () => {
  it.each(['save', 'publish'])(
    'validates media before %s and preserves siblings',
    async (action) => {
      const { req, update } = fixture(42, action)
      expect((await handler(req as never)).status).toBe(200)
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          overrideAccess: false,
          draft: action === 'save',
          data: {
            _status: action === 'save' ? 'draft' : 'published',
            layout: [{ blockType: 'hero', id: 'row', image: 42, title: 'Keep' }],
          },
        }),
      )
      expect(req.payload.find).toHaveBeenCalledWith(
        expect.objectContaining({ collection: 'assets', overrideAccess: false, req }),
      )
    },
  )
  it('rejects required clearing even for a draft save', async () => {
    const { req, update } = fixture(null)
    expect((await handler(req as never)).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
  it('rejects field write denial without silently reporting success', async () => {
    const { req, update, fieldUpdate } = fixture()
    fieldUpdate.mockResolvedValue(false)
    expect((await handler(req as never)).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
  it('rejects media excluded by read access or the field filter', async () => {
    const { req, update } = fixture()
    req.payload.find.mockResolvedValue({ docs: [] })
    expect((await handler(req as never)).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
