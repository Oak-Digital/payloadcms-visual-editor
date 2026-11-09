import type { PayloadRequest } from 'payload'
import type { resolveField } from './rich-text.js'

export async function relationshipFilter(
  resolved: NonNullable<ReturnType<typeof resolveField>>,
  relationTo: string,
  data: Record<string, any>,
  req: PayloadRequest,
) {
  const field = resolved.field
  if (field.type !== 'relationship') throw new Error('Invalid relationship')
  const filter =
    typeof field.filterOptions === 'function'
      ? await field.filterOptions({
          req,
          id: data.id,
          data,
          siblingData: resolved.ancestors.at(-1)?.siblingData,
          blockData: resolved.ancestors.find((a) => a.siblingData?.blockType)?.siblingData,
          relationTo,
          user: req.user,
        })
      : field.filterOptions
  if (filter === false) throw new Error('No content is permitted by this field')
  return filter && typeof filter === 'object' ? filter : {}
}

export async function checkRelationship(
  resolved: NonNullable<ReturnType<typeof resolveField>>,
  value: any,
  req: PayloadRequest,
  data: Record<string, any>,
) {
  const field = resolved.field
  if (field.type !== 'relationship' || value === null) return
  if (field.hasMany) throw new Error('Multiple relationships are not supported')
  const polymorphic = Array.isArray(field.relationTo)
  const relationTo = polymorphic ? value?.relationTo : field.relationTo
  const id = polymorphic ? value?.value : value
  if (
    !(typeof id === 'string' || typeof id === 'number') ||
    !(polymorphic ? field.relationTo.includes(relationTo) : relationTo === field.relationTo)
  )
    throw new Error('Invalid relationship')
  const filter = await relationshipFilter(resolved, relationTo, data, req)
  const found = await req.payload.find({
    collection: relationTo,
    where: { and: [filter, { id: { equals: id } }] },
    limit: 1,
    depth: 0,
    overrideAccess: false,
    req,
  })
  if (!found.docs.length) throw new Error('Select an accessible related document')
}
