import type { Field, PayloadRequest } from 'payload'
import { getFieldPaths } from 'payload/shared'
import type { LexicalRichTextAdapter } from '@payloadcms/richtext-lexical'
import { createHeadlessEditor } from '@payloadcms/richtext-lexical/lexical/headless'
import { isDeepStrictEqual } from 'node:util'

export type RichTextValue = { root: { type: string; children: unknown[]; [key: string]: unknown } }

export function isRichText(value: unknown): value is RichTextValue {
  if (!value || typeof value !== 'object' || !('root' in value)) return false
  const root = value.root
  return (
    !!root &&
    typeof root === 'object' &&
    'type' in root &&
    root.type === 'root' &&
    'children' in root &&
    Array.isArray(root.children)
  )
}

// Resolve instance paths to schema paths without allowing clients to select a different editor.
export function resolveField(
  fields: Field[],
  doc: any,
  path: string,
  schema = '',
  ancestors: { field: Field; siblingData: any }[] = [],
  parentIndexPath = '',
):
  | {
      field: Field
      value: any
      schemaPath: string
      ancestors: { field: Field; siblingData: any }[]
    }
  | undefined {
  for (const [index, field] of fields.entries()) {
    const { schemaPath, indexPath } = getFieldPaths({
      field,
      index,
      parentIndexPath,
      parentSchemaPath: schema,
    })
    const chain = [...ancestors, { field, siblingData: doc }]
    if (
      field.type === 'row' ||
      field.type === 'collapsible' ||
      (field.type === 'group' && !('name' in field))
    ) {
      const found = resolveField(field.fields, doc, path, schemaPath, chain, indexPath)
      if (found) return found
    } else if (field.type === 'tabs') {
      for (const [tabIndex, tab] of field.tabs.entries()) {
        const tabPaths = getFieldPaths({
          field: { ...tab, type: 'tab' },
          index: tabIndex,
          parentIndexPath: indexPath,
          parentSchemaPath: schemaPath,
        })
        const named = 'name' in tab && tab.name
        if (named && !path.startsWith(`${named}.`)) continue
        const found = resolveField(
          tab.fields,
          named ? doc?.[named] : doc,
          named ? path.slice(named.length + 1) : path,
          tabPaths.schemaPath,
          chain,
          named ? '' : tabPaths.indexPath,
        )
        if (found) return found
      }
    } else if ('name' in field) {
      const value = doc?.[field.name]
      if (path === field.name) return { field, value, schemaPath, ancestors: chain }
      if (!path.startsWith(`${field.name}.`)) continue
      const rest = path.slice(field.name.length + 1)
      if (field.type === 'group') return resolveField(field.fields, value, rest, schemaPath, chain)
      if (field.type === 'array' || field.type === 'blocks') {
        const [index, ...tail] = rest.split('.')
        if (
          !index ||
          !/^(0|[1-9]\d*)$/.test(index) ||
          !Array.isArray(value) ||
          !value[Number(index)]
        )
          return
        const row = value[Number(index)]
        const block =
          field.type === 'blocks' ? field.blocks.find((b) => b.slug === row.blockType) : undefined
        const childFields = field.type === 'array' ? field.fields : block?.fields
        if (childFields)
          return resolveField(
            childFields,
            row,
            tail.join('.'),
            block ? `${schemaPath}.${block.slug}` : schemaPath,
            chain,
          )
      }
    }
  }
}

export async function assertFieldAccess(
  resolved: NonNullable<ReturnType<typeof resolveField>>,
  doc: any,
  req: PayloadRequest,
  data: any = doc,
  operations: ('read' | 'update')[] = ['read', 'update'],
) {
  for (const { field, siblingData } of resolved.ancestors) {
    if (
      (field.admin && 'readOnly' in field.admin && field.admin.readOnly) ||
      ('virtual' in field && field.virtual)
    )
      throw new Error('Field is read-only')
    if ('access' in field) {
      for (const operation of operations) {
        const access = field.access?.[operation]
        if (
          access &&
          !(await access({
            req,
            id: doc.id,
            doc,
            data,
            siblingData,
            blockData: [...resolved.ancestors]
              .reverse()
              .find((ancestor) => ancestor.siblingData?.blockType)?.siblingData,
          }))
        ) {
          throw new Error('Field access denied')
        }
      }
    }
  }
}

// A headless round trip uses the host's actual node classes. Unknown nodes and fields
// lost by import/export block editing instead of silently normalizing stored content.
export function assertSupportedRichText(field: Field, value: unknown) {
  if (field.type !== 'richText' || !isRichText(value))
    throw new Error('Expected a Lexical rich-text field')
  const adapter = field.editor as LexicalRichTextAdapter
  if (!adapter?.editorConfig?.features?.nodes)
    throw new Error('This field does not use a supported Lexical editor')
  const editor = createHeadlessEditor({
    namespace: 'visual-editor-validation',
    nodes: adapter.editorConfig.features.nodes.map(({ node }) => node),
    onError: (error) => {
      throw error
    },
  })
  const state = editor.parseEditorState(JSON.stringify(value))
  const exported = state.toJSON()
  let mismatch = ''
  const preserves = (original: any, result: any, path = ''): boolean => {
    mismatch = path
    if (original === null || typeof original !== 'object')
      return isDeepStrictEqual(original, result)
    if (!result || typeof result !== 'object') return false
    if (Array.isArray(original) && (!Array.isArray(result) || original.length !== result.length))
      return false
    return Object.keys(original).every((key) => {
      // Lexical derives paragraph cursor formatting from its text children.
      if (original.type === 'paragraph' && ['textFormat', 'textStyle'].includes(key)) return true
      return preserves(original[key], result[key], `${path}.${key}`)
    })
  }
  if (!preserves(value, exported))
    throw new Error(
      `This content cannot round-trip without changes (${mismatch}). Edit it in the full admin editor.`,
    )
}
