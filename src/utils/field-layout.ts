import type { Field } from 'payload'

/** Presentation only. Leaf paths remain the original, server-validated editing paths. */
export type FieldLayout = {
  children?: FieldLayout[]
  collapsed?: boolean
  label: string
  path: string
  type: string
}

export const humanizeField = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())

type Descriptor = {
  hidden?: boolean
  label?: string
  options?: { label: string; value: string }[]
  type: string
  value?: unknown
}

/** Build the same layout for block and shared editors from their access-filtered descriptors. */
export function buildFieldLayout(
  fields: Field[],
  document: unknown,
  descriptors: Record<string, Descriptor>,
  prefix = '',
  identity = prefix,
): FieldLayout[] {
  const source =
    document && typeof document === 'object' ? (document as Record<string, unknown>) : undefined
  const result: FieldLayout[] = []
  for (const [index, field] of fields.entries()) {
    const key = `${identity}@${index}`
    if (field.type === 'tabs') {
      const children = field.tabs.flatMap((tab, i) => {
        const name = 'name' in tab ? tab.name : undefined
        const path = name ? `${prefix}${name}` : `${key}@tab${i}`
        const children = buildFieldLayout(
          tab.fields,
          name ? source?.[name] : source,
          descriptors,
          name ? `${path}.` : prefix,
          `${key}@tab${i}`,
        )
        return children.length
          ? [
              {
                type: 'tab',
                children,
                label:
                  typeof tab.label === 'string'
                    ? tab.label
                    : humanizeField(name || `Section ${i + 1}`),
                path,
              },
            ]
          : []
      })
      if (children.length) {
        result.push({ type: 'tabs', children, label: '', path: key })
      }
      continue
    }
    const name = 'name' in field ? field.name : undefined
    const path = name ? `${prefix}${name}` : key
    const label =
      'label' in field && field.label === false
        ? ''
        : 'label' in field && typeof field.label === 'string'
          ? field.label
          : name
            ? humanizeField(name)
            : ''
    if (field.type === 'row' || field.type === 'collapsible' || field.type === 'group') {
      const children = buildFieldLayout(
        field.fields,
        name ? source?.[name] : source,
        descriptors,
        name ? `${path}.` : prefix,
        key,
      )
      if (children.length) {
        result.push({
          type: field.type,
          children,
          label,
          path,
          ...(field.type === 'collapsible' && field.admin?.initCollapsed
            ? { collapsed: true }
            : {}),
        })
      }
    } else if (field.type === 'array' || field.type === 'blocks') {
      const rows = source?.[field.name]
      const children = (Array.isArray(rows) ? rows : []).flatMap((row, i) => {
        const block =
          field.type === 'blocks' ? field.blocks.find((b) => b.slug === row.blockType) : undefined
        const schema = field.type === 'array' ? field.fields : block?.fields
        if (!schema) {
          return []
        }
        const rowPath = `${path}.${i}`
        const children = buildFieldLayout(schema, row, descriptors, `${rowPath}.`)
        if (!children.length) {
          return []
        }
        // Labels only use fields already approved for this editor, never raw private row data.
        const candidates = Object.entries(descriptors).filter(
          ([p, d]) =>
            p.startsWith(`${rowPath}.`) &&
            !d.hidden &&
            ['select', 'text', 'textarea'].includes(d.type) &&
            typeof d.value === 'string' &&
            d.value,
        )
        const localCandidates = candidates.filter(
          ([path]) => !path.slice(rowPath.length + 1).includes('.'),
        )
        const labelCandidates = localCandidates.length ? localCandidates : candidates
        const preferred =
          labelCandidates.find(([p]) => /\.(?:title|name|label|heading|eyebrow)$/.test(p)) ??
          labelCandidates[0]
        const descriptor = preferred?.[1]
        const title =
          descriptor?.options?.find((o) => o.value === descriptor.value)?.label ?? descriptor?.value
        return [
          {
            type: 'item',
            children,
            label:
              typeof title === 'string'
                ? title
                : typeof block?.labels?.singular === 'string'
                  ? block.labels.singular
                  : `Item ${i + 1}`,
            path: rowPath,
          },
        ]
      })
      if (children.length || descriptors[path]) {
        result.push({ type: field.type, children, label, path })
      }
    } else if (descriptors[path]) {
      result.push({ type: field.type, label: descriptors[path].label || label, path })
    }
  }
  return result
}

export function findFieldLayout(nodes: FieldLayout[], path: string): FieldLayout | undefined {
  for (const node of nodes) {
    if (node.path === path) {
      return node
    }
    const child = node.children && findFieldLayout(node.children, path)
    if (child) {
      return child
    }
  }
}

export function fieldLayoutTrail(nodes: FieldLayout[], path: string): FieldLayout[] {
  for (const node of nodes) {
    if (node.path === path) {
      return [node]
    }
    const children = node.children && fieldLayoutTrail(node.children, path)
    if (children?.length) {
      return [node, ...children]
    }
  }
  return []
}
