import type { Field, PayloadRequest, UploadField, Where } from 'payload'

type Data = Record<string, any>
export type UploadTarget = {
  field: UploadField
  siblingData: Data
  blockData: Data | undefined
  ancestors: { field: Field; siblingData: Data }[]
}

/** Resolve only concrete, single upload fields. Never infer ownership from a media URL. */
export function uploadTargets(
  fields: Field[],
  data: Data,
  prefix = '',
  ancestors: UploadTarget['ancestors'] = [],
  blockData?: Data,
): Map<string, UploadTarget> {
  const result = new Map<string, UploadTarget>()
  const visit = (
    children: Field[],
    source: Data,
    path: string,
    parents = ancestors,
    block = blockData,
  ) => {
    for (const [key, target] of uploadTargets(children, source, path, parents, block))
      result.set(key, target)
  }
  for (const field of fields) {
    if (
      (field.admin && 'readOnly' in field.admin && field.admin.readOnly) ||
      ('virtual' in field && field.virtual)
    )
      continue
    const path = 'name' in field ? `${prefix}${field.name}` : prefix.slice(0, -1)
    const parents = [...ancestors, { field, siblingData: data }]
    if (field.type === 'upload' && !field.hasMany && typeof field.relationTo === 'string') {
      if (Object.hasOwn(data, field.name))
        result.set(path, { field, siblingData: data, ancestors: parents, blockData })
    } else if (field.type === 'group') {
      const source = 'name' in field ? data[field.name] : data
      if (source && typeof source === 'object') visit(field.fields, source, `${path}.`, parents)
    } else if (field.type === 'row' || field.type === 'collapsible') {
      visit(field.fields, data, prefix, parents)
    } else if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const named = 'name' in tab && tab.name
        const source = named ? data[named] : data
        if (source) visit(tab.fields, source, named ? `${prefix}${named}.` : prefix, parents)
      }
    } else if (field.type === 'array' || field.type === 'blocks') {
      const rows = data[field.name]
      if (Array.isArray(rows))
        rows.forEach((row, index) => {
          if (!row || typeof row !== 'object') return
          const children =
            field.type === 'array'
              ? field.fields
              : field.blocks.find((b) => b.slug === row.blockType)?.fields
          if (children)
            visit(
              children,
              row,
              `${path}.${index}.`,
              parents,
              field.type === 'blocks' ? row : blockData,
            )
        })
    }
  }
  return result
}

export async function assertUploadAccess(
  target: UploadTarget,
  req: PayloadRequest,
  data: Data,
  id: number | string,
) {
  for (const { field, siblingData } of target.ancestors) {
    if (!('access' in field)) continue
    for (const operation of ['read', 'update'] as const) {
      const access = field.access?.[operation]
      if (access && !(await access({ req, id, data, doc: data, siblingData })))
        throw new Error('Field access denied')
    }
  }
}

export async function mediaWhere(
  target: UploadTarget,
  req: PayloadRequest,
  data: Data,
  id: number | string,
): Promise<Where> {
  const { field, siblingData, blockData } = target
  const filter =
    typeof field.filterOptions === 'function'
      ? await field.filterOptions({
          req,
          id,
          data,
          siblingData,
          blockData,
          relationTo: field.relationTo as string,
          user: req.user,
        })
      : field.filterOptions
  if (filter === false) throw new Error('No media permitted by this field')
  const collection = req.payload.config.collections.find((c) => c.slug === field.relationTo)
  if (!collection?.upload) throw new Error('Not an upload collection')
  const mimeTypes = collection.upload.mimeTypes
  const mimeWhere: Where[] = [{ mimeType: { contains: 'image/' } }]
  if (mimeTypes?.length)
    mimeWhere.push({
      or: mimeTypes.map((mime) => ({
        mimeType: mime.endsWith('/*') ? { contains: mime.slice(0, -1) } : { equals: mime },
      })),
    })
  if (filter && typeof filter === 'object') mimeWhere.push(filter)
  return { and: mimeWhere }
}

export async function validateMedia(
  target: UploadTarget,
  value: unknown,
  req: PayloadRequest,
  data: Data,
  id: number | string,
) {
  await assertUploadAccess(target, req, data, id)
  if (value === null) {
    if (target.field.required) throw new Error('Image is required')
    return
  }
  if ((typeof value !== 'string' || !value) && typeof value !== 'number')
    throw new Error('Invalid media ID')
  const where = await mediaWhere(target, req, data, id)
  const result = await req.payload.find({
    collection: target.field.relationTo as string,
    where: { and: [where, { id: { equals: value } }] },
    limit: 1,
    depth: 0,
    overrideAccess: false,
    req,
  })
  const media = result.docs[0]
  const config = req.payload.config.collections.find((c) => c.slug === target.field.relationTo)!
  const restrictions = config.upload ? config.upload.mimeTypes : undefined
  if (
    !media ||
    !media.mimeType?.startsWith('image/') ||
    (restrictions?.length &&
      !restrictions.some((mime) =>
        mime.endsWith('/*')
          ? media.mimeType.startsWith(mime.slice(0, -1))
          : media.mimeType === mime,
      ))
  )
    throw new Error('Image is inaccessible or does not match field restrictions')
}
