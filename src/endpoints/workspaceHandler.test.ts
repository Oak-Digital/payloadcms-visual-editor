import { expect, it, vi } from 'vitest'
import { createWorkspaceHandler } from './workspaceHandler.js'

it('reads only offered languages through native access and never writes during language discovery', async () => {
  const findByID = vi.fn(async ({ locale }) => ({
    id: 'page',
    title: locale === 'en' ? 'Page' : '',
    slug: locale === 'en' ? 'english' : '',
    _status: 'draft',
  }))
  const find = vi.fn(async () => ({ docs: [] }))
  const update = vi.fn()
  const locales = [
    { code: 'en', label: 'English' },
    { code: 'da', label: 'Dansk' },
    { code: 'fr', label: 'Français' },
  ]
  const req: any = {
    user: { id: 'editor' },
    json: async () => ({ collection: 'pages', id: 'page' }),
    payload: {
      config: {
        localization: {
          locales,
          filterAvailableLocales: ({ locales }: any) => locales.slice(0, 2),
        },
      },
      findByID,
      find,
      update,
    },
  }
  const handler = createWorkspaceHandler({
    pages: {
      fields: [],
      previewURL: (doc, locale) => `/${locale}/${doc.slug}`,
      hasContent: (doc) => Boolean(doc.title),
    },
  })
  const response = await handler(req)
  expect(await response.json()).toEqual({
    languages: [
      { code: 'en', label: 'English', status: 'Draft', url: '/en/english' },
      { code: 'da', label: 'Dansk', status: 'No content', url: '/da/' },
    ],
  })
  expect(findByID.mock.calls.map(([args]) => args.locale)).toEqual(['en', 'da'])
  for (const [args] of findByID.mock.calls)
    expect(args).toMatchObject({ overrideAccess: false, fallbackLocale: false, req })
  expect(update).not.toHaveBeenCalled()
  req.user = undefined
  expect((await handler(req)).status).toBe(401)
})
