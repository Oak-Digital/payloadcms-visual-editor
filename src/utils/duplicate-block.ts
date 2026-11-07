import { createHash } from 'node:crypto'
import type { Field } from 'payload'

/** Clone schema-owned rows, preserving relationship and upload identities. */
export function duplicateBlock(
  fields: Field[],
  source: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  const copy = structuredClone(source)
  function visit(schema: Field[], value: Record<string, any>, path: string) {
    for (const field of schema) {
      if (field.type === 'tabs') {
        for (const tab of field.tabs) {
          if ('name' in tab && tab.name) {
            if (value[tab.name]) visit(tab.fields, value[tab.name], `${path}.${tab.name}`)
          } else visit(tab.fields, value, path)
        }
      } else if (
        field.type === 'row' ||
        field.type === 'collapsible' ||
        (field.type === 'group' && !('name' in field))
      ) {
        visit(field.fields, value, path)
      } else if ('name' in field) {
        const child = value[field.name]
        const childPath = `${path}.${field.name}`
        if (field.type === 'group' && child && typeof child === 'object')
          visit(field.fields, child, childPath)
        if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(child)) {
          child.forEach((row, index) => {
            const rowPath = `${childPath}.${index}`
            row.id = createHash('sha256').update(`${id}:${rowPath}`).digest('hex').slice(0, 24)
            const children =
              field.type === 'array'
                ? field.fields
                : field.blocks.find((block) => block.slug === row.blockType)?.fields
            if (children) visit(children, row, rowPath)
          })
        }
      }
    }
  }
  visit(fields, copy, '')
  copy.id = id
  return copy
}
