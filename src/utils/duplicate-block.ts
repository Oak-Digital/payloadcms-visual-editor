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

/** Cross-collection copies contain only fields declared by the destination schema. */
export function projectBlockFields(
  fields: Field[],
  source: Record<string, any>,
): Record<string, any> {
  const result: Record<string, any> = {}
  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        if ('name' in tab && tab.name) {
          if (source[tab.name] && typeof source[tab.name] === 'object')
            result[tab.name] = projectBlockFields(tab.fields, source[tab.name])
        } else Object.assign(result, projectBlockFields(tab.fields, source))
      }
    } else if ('fields' in field && !('name' in field)) {
      Object.assign(result, projectBlockFields(field.fields, source))
    } else if (
      'name' in field &&
      Object.hasOwn(source, field.name) &&
      !('virtual' in field && field.virtual)
    ) {
      const value = source[field.name]
      if (field.type === 'group' && value && typeof value === 'object')
        result[field.name] = projectBlockFields(field.fields, value)
      else if ((field.type === 'array' || field.type === 'blocks') && Array.isArray(value)) {
        result[field.name] = value.map((row) => {
          const schema =
            field.type === 'array'
              ? field.fields
              : field.blocks.find((block) => block.slug === row.blockType)?.fields
          if (!schema) throw new Error('Copied layout contains an unsupported block')
          return {
            ...projectBlockFields(schema, row),
            ...(field.type === 'blocks' ? { blockType: row.blockType } : {}),
            id: row.id,
          }
        })
      } else result[field.name] = structuredClone(value)
    }
  }
  return result
}
