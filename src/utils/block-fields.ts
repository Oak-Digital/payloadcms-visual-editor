import type { Field, PayloadRequest } from 'payload'
import type { ArrangeField } from './arrange.js'
import { setPath } from './arrange.js'
import { resolveField } from './rich-text.js'
import { relationshipFilter } from './relationship-fields.js'

type Resolved = NonNullable<ReturnType<typeof resolveField>>

export function fieldPresentation(
  resolved: Resolved,
  document: any,
  req: PayloadRequest,
  path: string,
) {
  const blockData = [...resolved.ancestors]
    .reverse()
    .find((item) => item.siblingData?.blockType)?.siblingData
  return {
    ...('label' in resolved.field && typeof resolved.field.label === 'string'
      ? { label: resolved.field.label }
      : {}),
    conditional: resolved.ancestors.some(({ field }) => Boolean(field.admin?.condition)),
    hidden: resolved.ancestors.some(({ field, siblingData }) => {
      if (field.admin && 'hidden' in field.admin && field.admin.hidden) return true
      try {
        return Boolean(
          field.admin?.condition &&
            !field.admin.condition(document, siblingData ?? {}, {
              user: req.user,
              blockData,
              operation: 'update',
              path: path.split('.'),
            }),
        )
      } catch {
        return true
      }
    }),
  }
}

export async function blockControl(
  resolved: Resolved,
  document: any,
  req: PayloadRequest,
): Promise<ArrangeField | undefined> {
  const { field, value } = resolved
  if (field.type === 'checkbox' || field.type === 'number' || field.type === 'email')
    return {
      type: field.type,
      value: value ?? (field.type === 'checkbox' ? false : field.type === 'email' ? '' : null),
    }
  if ((field.type === 'radio' || field.type === 'select') && !('hasMany' in field && field.hasMany))
    return {
      type: field.type,
      value: value ?? null,
      options: field.options.map((option) =>
        typeof option === 'string'
          ? { label: option, value: option }
          : {
              label: typeof option.label === 'string' ? option.label : option.value,
              value: option.value,
            },
      ),
    }
  if (field.type !== 'relationship' || field.hasMany || field.custom?.visualEditorLayout) return
  const polymorphic = Array.isArray(field.relationTo)
  const choices: { label: string; value: unknown }[] = []
  for (const relationTo of typeof field.relationTo === 'string'
    ? [field.relationTo]
    : field.relationTo) {
    try {
      const filter = await relationshipFilter(resolved, relationTo, document, req)
      const collection = req.payload.config.collections.find((item) => item.slug === relationTo)
      const title = collection?.admin?.useAsTitle || 'id'
      const result = await req.payload.find({
        collection: relationTo,
        where: filter,
        depth: 0,
        pagination: false,
        limit: 0,
        overrideAccess: false,
        req,
      })
      choices.push(
        ...result.docs.map((doc) => ({
          label: `${polymorphic ? `${relationTo} · ` : ''}${String(doc[title] || doc.id)}`,
          value: polymorphic ? { relationTo, value: doc.id } : doc.id,
        })),
      )
    } catch {
      // A denied related collection must not hide the rest of this field's choices.
    }
  }
  return { type: 'reference', value: value ?? null, choices }
}

/** Only schema-backed groups can be initialized when an optional parent is absent. */
export function setBlockField(fields: Field[], document: any, path: string, value: unknown) {
  const parts = path.split('.')
  for (let length = 1; length < parts.length; length++) {
    const parentPath = parts.slice(0, length).join('.')
    const parent = resolveField(fields, document, parentPath)
    if (parent?.field.type === 'group' && parent.value == null) setPath(document, parentPath, {})
  }
  setPath(document, path, value)
}

export function validateBlockControl(field: ArrangeField, value: unknown) {
  if (field.type === 'checkbox') {
    if (typeof value !== 'boolean') throw new Error('Checkbox must be a boolean')
  } else if (field.type === 'number') {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value)))
      throw new Error('Invalid number')
  } else if (field.type === 'radio' || field.type === 'select') {
    if (value !== null && !field.options.some((option) => option.value === value))
      throw new Error('Invalid option')
  } else if (field.type === 'email' && typeof value !== 'string')
    throw new Error('Text must be a string')
}
