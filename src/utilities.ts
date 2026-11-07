export { imagePlaceholder } from './utils/image-placeholder.js'

import type { PayloadCMSDocument } from './types.js'
import type { SourceMap } from './utils/source-map.js'

export type EditableAttrs = {
  'data-payload-path'?: string
  'data-payload-type'?: string
  'data-payload-document'?: string
}

export function createEditableAttrs(sourceMap?: SourceMap, owner?: PayloadCMSDocument) {
  return (path: string): EditableAttrs => {
    if (!sourceMap || !Object.hasOwn(sourceMap, path)) return {}
    return {
      'data-payload-path': path,
      ...(typeof sourceMap[path] === 'object' ? { 'data-payload-type': sourceMap[path].type } : {}),
      ...(owner ? { 'data-payload-document': JSON.stringify(owner) } : {}),
    }
  }
}

type BoundValue = {
  _visualEditor?: EditableAttrs
  _visualEditorFields?: Record<string, EditableAttrs>
}
export function editableField(value: unknown, field: string): EditableAttrs | undefined {
  return value && typeof value === 'object'
    ? (value as BoundValue)._visualEditorFields?.[field]
    : undefined
}
export function editableValue(value: unknown): EditableAttrs | undefined {
  return value && typeof value === 'object' ? (value as BoundValue)._visualEditor : undefined
}

/** Bind each occurrence, not each media ID. Copies keep shared media usages independent. */
export function bindSourceMap<T>(
  document: T,
  sourceMap: SourceMap | undefined,
  owner: PayloadCMSDocument,
  rowPaths?: Record<string, string>,
): T {
  if (!sourceMap) return document
  const attrs = createEditableAttrs(sourceMap, owner)
  const fieldsByParent = new Map<string, Record<string, EditableAttrs>>()
  for (const fieldPath of Object.keys(sourceMap)) {
    const split = fieldPath.lastIndexOf('.')
    const parent = split < 0 ? '' : fieldPath.slice(0, split)
    const name = fieldPath.slice(split + 1)
    const fields = fieldsByParent.get(parent) ?? {}
    fields[name] = attrs(fieldPath)
    fieldsByParent.set(parent, fields)
  }
  function bind(value: unknown, path: string, sourcePath = path): unknown {
    if (Array.isArray(value))
      return value.map((item, index) => {
        const nextPath = path ? `${path}.${index}` : String(index)
        const stablePath =
          item && typeof item === 'object' && typeof item.id === 'string'
            ? rowPaths?.[item.id]
            : undefined
        if (rowPaths && !stablePath) return item
        return bind(
          item,
          nextPath,
          stablePath ?? (sourcePath ? `${sourcePath}.${index}` : String(index)),
        )
      })
    if (!value || typeof value !== 'object') return value
    const result: Record<string, unknown> = {}
    const fields = fieldsByParent.get(path)
    for (const [name, child] of Object.entries(value)) {
      if (name === '_sourceMap' || name.startsWith('_visualEditor')) continue
      const childPath = path ? `${path}.${name}` : name
      result[name] = bind(child, childPath, sourcePath ? `${sourcePath}.${name}` : name)
    }
    if (fields)
      result._visualEditorFields = Object.fromEntries(
        Object.entries(fields).map(([name, field]) => [
          name,
          { ...field, 'data-payload-path': sourcePath ? `${sourcePath}.${name}` : name },
        ]),
      )
    if (Object.hasOwn(sourceMap!, path))
      result._visualEditor = { ...attrs(path), 'data-payload-path': sourcePath }
    return result
  }
  return bind(document, '') as T
}

export function isSourceMap(value: unknown): value is SourceMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(
    (entry) =>
      typeof entry === 'string' ||
      (entry &&
        typeof entry === 'object' &&
        (entry.type === 'richText' ||
          entry.type === 'relationship' ||
          (entry.type === 'upload' &&
            (entry.value === null ||
              typeof entry.value === 'string' ||
              typeof entry.value === 'number')))),
  )
}
