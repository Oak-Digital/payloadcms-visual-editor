import type { Field, PayloadRequest } from 'payload'

export function layoutReferences(
  fields: Field[],
  prefix = '',
): { path: string; collection: string; layoutPath: string }[] {
  return fields.flatMap((field) => {
    const path = 'name' in field ? [prefix, field.name].filter(Boolean).join('.') : prefix
    if (
      field.type === 'relationship' &&
      !field.hasMany &&
      typeof field.relationTo === 'string' &&
      typeof field.custom?.visualEditorLayout === 'string'
    )
      return [{ path, collection: field.relationTo, layoutPath: field.custom.visualEditorLayout }]
    if (field.type === 'tabs')
      return field.tabs.flatMap((tab) =>
        layoutReferences(
          tab.fields,
          'name' in tab && tab.name ? [prefix, tab.name].filter(Boolean).join('.') : prefix,
        ),
      )
    if (field.type === 'blocks')
      return field.blocks.flatMap((block) => layoutReferences(block.fields, path))
    if ('fields' in field) return layoutReferences(field.fields, path)
    return []
  })
}

/** Include draft and published references; never reveal pages the editor cannot read. */
export async function layoutUsages(
  req: PayloadRequest,
  enabled: Record<string, unknown>,
  collection: string,
  id: string | number,
) {
  const usages = new Map<
    string,
    { collection: string; id: string; label: string; draft: boolean; published: boolean }
  >()
  let hasMore = false
  let incomplete = false
  for (const source of req.payload.config.collections) {
    if (!enabled[source.slug]) continue
    const paths = [
      ...new Set(
        layoutReferences(source.fields)
          .filter((ref) => ref.collection === collection)
          .map((ref) => ref.path),
      ),
    ]
    if (!paths.length) continue
    for (const draft of [false, true]) {
      const result = await req.payload
        .find({
          collection: source.slug,
          draft,
          depth: 0,
          limit: 50,
          overrideAccess: false,
          req,
          where: { or: paths.map((path) => ({ [path]: { equals: id } })) },
        })
        .catch((cause: unknown) => {
          if (cause && typeof cause === 'object' && 'status' in cause && cause.status === 403) {
            incomplete = true
            return undefined
          }
          throw cause
        })
      if (!result) continue
      hasMore ||= !!result.hasNextPage
      for (const doc of result.docs) {
        if (!draft && doc._status !== 'published') continue
        const key = `${source.slug}:${doc.id}`
        const usage = usages.get(key) ?? {
          collection: source.slug,
          id: String(doc.id),
          label: String(doc[source.admin?.useAsTitle || 'title'] || doc.id),
          draft: false,
          published: false,
        }
        if (draft) usage.draft = true
        else usage.published = true
        usages.set(key, usage)
      }
    }
  }
  return { usages: [...usages.values()], hasMore, ...(incomplete ? { incomplete: true } : {}) }
}
