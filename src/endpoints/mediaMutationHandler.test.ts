import { expect, it, vi } from 'vitest'
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
it('replaces an accessible image and refuses invalid or forbidden replacements without writing', async () => {
  const valid = fixture(42)
  expect((await handler(valid.req as never)).status).toBe(200)
  expect(valid.update).toHaveBeenCalledWith(
    expect.objectContaining({
      overrideAccess: false,
      draft: true,
      data: {
        _status: 'draft',
        layout: [{ blockType: 'hero', id: 'row', image: 42, title: 'Keep' }],
      },
    }),
  )
  expect(valid.req.payload.find).toHaveBeenCalledWith(
    expect.objectContaining({
      collection: 'assets',
      overrideAccess: false,
      req: valid.req,
    }),
  )
  for (const reason of ['required', 'field access', 'media filter']) {
    const f = fixture(reason === 'required' ? null : 'new')
    if (reason === 'field access') f.fieldUpdate.mockResolvedValue(false)
    if (reason === 'media filter') f.req.payload.find.mockResolvedValue({ docs: [] })
    expect((await handler(f.req as never)).status, reason).toBe(400)
    expect(f.update).not.toHaveBeenCalled()
  }
})
