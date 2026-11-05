import { describe, expect, it, vi } from 'vitest'
import { createVisualEditorMutationHandler } from './visualEditorMutationHandler.js'

const handler = createVisualEditorMutationHandler({ pages: true })
function fixture(overrides = {}) {
  const findByID = vi
    .fn()
    .mockResolvedValue({
      id: 'page',
      title: 'Original',
      layout: [{ blockType: 'hero', heading: 'Original', id: 'block' }],
    })
  const update = vi.fn().mockResolvedValue({ id: 'page' })
  const req = {
    user: { id: 'editor' },
    json: async () => ({
      id: 'page',
      collection: 'pages',
      locale: 'da',
      action: 'save',
      patches: [{ path: 'layout.0.heading', value: 'Ny overskrift' }],
      ...overrides,
    }),
    payload: {
      config: {
        localization: { localeCodes: ['en', 'da'] },
        collections: [
          {
            slug: 'pages',
            versions: { drafts: true },
            fields: [
              { type: 'text', name: 'title' },
              {
                type: 'blocks',
                name: 'layout',
                blocks: [{ slug: 'hero', fields: [{ type: 'text', name: 'heading' }] }],
              },
            ],
          },
        ],
      },
      findByID,
      update,
      logger: { error: vi.fn() },
    },
  }
  return { req, findByID, update }
}

describe('visual editor mutation', () => {
  it('saves nested text in the requested locale with access control and draft isolation', async () => {
    const { req, findByID, update } = fixture()
    expect((await handler(req as never)).status).toBe(200)
    expect(findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'da',
        fallbackLocale: false,
        draft: true,
        overrideAccess: false,
        req,
      }),
    )
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: 'da',
        draft: true,
        overrideAccess: false,
        req,
        data: {
          _status: 'draft',
          layout: [{ blockType: 'hero', id: 'block', heading: 'Ny overskrift' }],
        },
      }),
    )
  })
  it('publishes through the normal validated update operation', async () => {
    const { req, update } = fixture({ action: 'publish' })
    expect((await handler(req as never)).status).toBe(200)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: false,
        overrideAccess: false,
        data: expect.objectContaining({ _status: 'published' }),
      }),
    )
  })
  it.each([
    [{ collection: 'users' }, 403],
    [{ locale: undefined }, 400],
    [{ locale: 'all' }, 400],
    [{ patches: [{ path: '_status', value: 'published' }] }, 400],
    [{ patches: [{ path: '__proto__.polluted', value: 'bad' }] }, 400],
    [{ patches: [{ path: 'layout.0.id', value: 'changed' }] }, 400],
    [{ patches: [null] }, 400],
    [{ patches: [] }, 400],
  ])('rejects out-of-scope changes %j', async (overrides, status) => {
    const { req, update } = fixture(overrides)
    expect((await handler(req as never)).status).toBe(status)
    expect(update).not.toHaveBeenCalled()
  })
  it('rejects anonymous users', async () => {
    const { req, findByID, update } = fixture()
    expect((await handler({ ...req, user: null } as never)).status).toBe(401)
    expect(findByID).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })
  it('does not update when collection access denies a read', async () => {
    const { req, findByID, update } = fixture()
    findByID.mockRejectedValue(new Error('Forbidden'))
    expect((await handler(req as never)).status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
