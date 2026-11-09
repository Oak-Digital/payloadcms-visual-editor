import type { Field } from 'payload'

import { uploadTargets } from './upload-fields.js'

export type SourceMap = Record<
  string,
  | string
  | { type: 'richText' | 'relationship' | 'control' }
  | { type: 'upload'; value: string | number | null }
>

// =============================================================================
// PayloadCMS Content Source Map Utilities
//
// This module provides utilities for creating a source map given a PayloadCMS
// document data and its collection's fields.
// =============================================================================

/**
 * Type guard to check if a value is a plain object (not an array or null).
 * @param value - The value to check
 * @returns True if value is a plain object
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object'
}

/**
 * Gets a named property value from a source object.
 * @param source - The source object to read from
 * @param name - The property name to retrieve
 * @returns The property value or undefined if source is not a valid record
 */
function getNamedValue(source: unknown, name: string): unknown {
  if (!isRecord(source)) {
    return undefined
  }

  return source[name]
}

/**
 * Appends a path segment to an existing path string.
 * @param path - The existing path (can be empty string)
 * @param segment - The segment to append
 * @returns The combined path with segment separated by dot
 */
function appendPath(path: string, segment: string): string {
  return path ? `${path}.${segment}` : segment
}

/**
 * Recursively traverses Payload fields and builds a source map of editable text values.
 * @param params.fields - Array of Payload fields to process
 * @param params.path - Current path in dot notation
 * @param params.source - Source document object to extract values from
 * @param params.sourceMap - Map to populate with path -> value entries
 */
function addEditableFields({
  fields,
  path,
  source,
  sourceMap,
  controls,
}: {
  fields: Field[]
  path: string
  source: unknown
  sourceMap: SourceMap
  controls: boolean
}): void {
  for (const field of fields) {
    if ('name' in field && ['id', 'blockType', 'blockName'].includes(field.name)) continue
    if (
      (field.admin && 'readOnly' in field.admin && field.admin.readOnly) ||
      ('virtual' in field && field.virtual)
    )
      continue
    switch (field.type) {
      case 'array': {
        const rows = getNamedValue(source, field.name)
        if (Array.isArray(rows))
          rows.forEach((row, index) => {
            addEditableFields({
              fields: field.fields,
              path: appendPath(path, `${field.name}.${index}`),
              source: row,
              controls,
              sourceMap,
            })
          })
        break
      }
      case 'blocks': {
        const rows = getNamedValue(source, field.name)
        if (Array.isArray(rows))
          rows.forEach((row, index) => {
            if (!isRecord(row)) return
            const block = field.blocks.find((candidate) => candidate.slug === row.blockType)
            if (block)
              addEditableFields({
                fields: block.fields,
                path: appendPath(path, `${field.name}.${index}`),
                source: row,
                controls,
                sourceMap,
              })
          })
        break
      }
      case 'collapsible':
      case 'row': {
        addEditableFields({
          fields: field.fields,
          path,
          source,
          controls,
          sourceMap,
        })
        break
      }

      case 'group': {
        const nextPath = 'name' in field ? appendPath(path, field.name) : path
        const nextSource = 'name' in field ? getNamedValue(source, field.name) : source

        addEditableFields({
          fields: field.fields,
          path: nextPath,
          source: controls ? (nextSource ?? {}) : nextSource,
          controls,
          sourceMap,
        })
        break
      }

      case 'tabs': {
        for (const tab of field.tabs) {
          if ('name' in tab && tab.name) {
            addEditableFields({
              fields: tab.fields,
              path: appendPath(path, tab.name),
              source: getNamedValue(source, tab.name),
              controls,
              sourceMap,
            })
          } else {
            addEditableFields({
              fields: tab.fields,
              path,
              source,
              controls,
              sourceMap,
            })
          }
        }
        break
      }

      case 'checkbox':
      case 'radio':
      case 'select':
      case 'number':
      case 'email': {
        if (controls && !('hasMany' in field && field.hasMany))
          sourceMap[appendPath(path, field.name)] = { type: 'control' }
        break
      }
      case 'relationship': {
        if (controls && !field.hasMany) {
          sourceMap[appendPath(path, field.name)] = { type: 'control' }
          break
        }
        if (
          typeof field.custom?.visualEditorLayout === 'string' &&
          !field.hasMany &&
          typeof field.relationTo === 'string'
        )
          sourceMap[appendPath(path, field.name)] = { type: 'relationship' }
        break
      }
      case 'richText': {
        const value = getNamedValue(source, field.name)
        if (isRecord(value) && isRecord(value.root)) {
          sourceMap[appendPath(path, field.name)] = { type: 'richText' }
        }
        break
      }

      case 'text':
      case 'textarea': {
        const value = getNamedValue(source, field.name)

        if (isRecord(source) && (value == null || typeof value === 'string')) {
          sourceMap[appendPath(path, field.name)] = value ?? ''
        }

        break
      }
    }
  }
}

/**
 * Builds a source map from Payload fields and a document.
 * Maps nested field paths to their string values for editing.
 * @param fields - Array of Payload fields to extract values from
 * @param document - The document object to extract values from
 * @returns Record mapping field paths to their string values
 */
export function buildSourceMap(fields: Field[], document: unknown, controls = false): SourceMap {
  const sourceMap: SourceMap = {}

  addEditableFields({
    fields,
    path: '',
    source: document,
    controls,
    sourceMap,
  })

  const result: SourceMap = sourceMap
  if (isRecord(document))
    for (const [path, { field, siblingData }] of uploadTargets(fields, document)) {
      const value = siblingData[field.name]
      const id = isRecord(value) ? value.id : value
      if (id == null || typeof id === 'string' || typeof id === 'number')
        result[path] = { type: 'upload', value: id ?? null }
    }
  return result
}
