import type { CollectionSlug, PayloadHandler, TypedLocale } from 'payload'
import type { PageSettingsConfig } from '../utils/page-settings.js'

/** Read locale availability by document identity, never by matching translated slugs. */
export const createWorkspaceHandler =
  (settings: PageSettingsConfig): PayloadHandler =>
  async (req) => {
    if (!req.user) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    try {
      const body = await req.json?.()
      if (
        !body ||
        typeof body.collection !== 'string' ||
        !['string', 'number'].includes(typeof body.id)
      )
        throw new Error('Invalid document')
      const config = settings[body.collection]
      if (!config?.previewURL) throw new Error('Language switching is unavailable')
      const localization = req.payload.config.localization
      if (!localization) return Response.json({ languages: [] })
      const locales = localization.filterAvailableLocales
        ? await localization.filterAvailableLocales({ locales: localization.locales, req })
        : localization.locales
      const languages = []
      for (const locale of locales) {
        req.locale = locale.code as TypedLocale
        req.fallbackLocale = false
        const document = await req.payload.findByID({
          collection: body.collection as CollectionSlug,
          id: body.id,
          locale: req.locale,
          fallbackLocale: false,
          draft: true,
          depth: 0,
          overrideAccess: false,
          req,
        })
        const published = await req.payload.find({
          collection: body.collection as CollectionSlug,
          locale: req.locale,
          fallbackLocale: false,
          draft: false,
          depth: 0,
          limit: 1,
          overrideAccess: false,
          req,
          where: { and: [{ id: { equals: body.id } }, { _status: { equals: 'published' } }] },
        })
        const availability = await config.availability?.({
          document: published.docs[0] || document,
          locale: locale.code,
          published: Boolean(published.docs[0]),
          req,
        })
        languages.push({
          code: locale.code,
          label: typeof locale.label === 'string' ? locale.label : locale.code,
          status:
            config.hasContent && !config.hasContent(document)
              ? 'No content'
              : availability?.public
                ? document._status === 'draft'
                  ? 'Public · Draft changes'
                  : 'Public'
                : document._status === 'draft' && availability?.label !== 'Waiting for approval'
                  ? 'Draft'
                  : availability?.label || 'Draft',
          url: config.previewURL(document, locale.code),
        })
      }
      return Response.json({ languages })
    } catch {
      return Response.json({ error: 'Unable to load page languages. Try again.' }, { status: 400 })
    }
  }
