import type { Field, PayloadRequest } from 'payload'

/** Resolve preview relationships through the current user's access rules. */
export async function populatePreview(
  fields: Field[],
  document: any,
  req: PayloadRequest,
): Promise<any> {
  if (!document || typeof document !== 'object') return document
  const result = structuredClone(document)
  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if ('name' in tab && tab.name)
          result[tab.name] = await populatePreview(tab.fields, document[tab.name], req)
        else Object.assign(result, await populatePreview(tab.fields, result, req))
      }
    } else if (
      field.type === 'row' ||
      field.type === 'collapsible' ||
      (field.type === 'group' && !('name' in field))
    ) {
      Object.assign(result, await populatePreview(field.fields, result, req))
    } else if ('name' in field) {
      const value = document[field.name]
      if (field.type === 'group')
        result[field.name] = await populatePreview(field.fields, value, req)
      if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
        result[field.name] = await Promise.all(
          value.map((row) =>
            populatePreview(
              field.type === 'array'
                ? field.fields
                : (field.blocks.find((block) => block.slug === row.blockType)?.fields ?? []),
              row,
              req,
            ),
          ),
        )
      }
      if ((field.type === 'relationship' || field.type === 'upload') && value != null) {
        const resolve = async (item: any) => {
          const poly = Array.isArray(field.relationTo)
          const collection = poly ? item?.relationTo : field.relationTo
          const id = poly ? item?.value : item
          if (typeof id !== 'string' && typeof id !== 'number') return item
          try {
            const related = await req.payload.findByID({
              collection,
              id,
              depth: 3,
              draft: true,
              overrideAccess: false,
              req,
            })
            return poly ? { relationTo: collection, value: related } : related
          } catch {
            return null
          }
        }
        result[field.name] =
          field.hasMany && Array.isArray(value)
            ? await Promise.all(value.map(resolve))
            : await resolve(value)
      }
    }
  }
  return result
}
