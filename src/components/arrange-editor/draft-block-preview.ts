import type { PayloadCMSDocument } from '../../types.js'
import type { ArrangeSnapshot } from '../../utils/arrange.js'

import { documentKey, fieldDocument } from '../../utils/field-target.js'
import styles from './styles.module.scss'

type DraftSession = {
  additions: Record<string, { blockType: string; id: string }[]>
  changes: Record<string, unknown>
  orders: Record<string, string[]>
  owner: PayloadCMSDocument
  snapshot: ArrangeSnapshot
}

function textContent(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return ''
  }
  if ('text' in value && typeof value.text === 'string') {
    return value.text
  }
  if ('root' in value) {
    return textContent(value.root)
  }
  if ('children' in value && Array.isArray(value.children)) {
    return value.children.map(textContent).join(' ')
  }
  return ''
}

const placeholder = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#222"/><path d="m300 280 70-80 50 60 40-40 60 60M365 160a15 15 0 1 0 0 1" fill="none" stroke="#888" stroke-width="3"/><text x="400" y="335" text-anchor="middle" fill="#aaa" font-family="sans-serif" font-size="18">Choose image</text></svg>')}`

/** Own only unsaved preview nodes; React continues to own persisted sections. */
export function createDraftBlockPreviews(root: Document, fallback: PayloadCMSDocument) {
  const nodes = new Map<string, HTMLElement>()
  return {
    destroy() {
      for (const node of nodes.values()) {
        node.remove()
      }
      nodes.clear()
    },
    update(sessions: DraftSession[]) {
      const retained = new Set<string>()
      for (const list of root.querySelectorAll<HTMLElement>('[data-payload-block-list]')) {
        const key = documentKey(fieldDocument(list, fallback))
        const session = sessions.find((session) => documentKey(session.owner) === key)
        const path = list.dataset.payloadBlockList!
        if (!session) {
          continue
        }
        for (const [index, addition] of (session.additions[path] ?? []).entries()) {
          if (!session.orders[path]?.includes(addition.id)) {
            continue
          }
          const nodeKey = `${key}:${path}:${addition.id}`
          retained.add(nodeKey)
          let node = nodes.get(nodeKey)
          const prefix = `${path}.${session.snapshot.orders[path].length + index}.`
          if (!node) {
            node = root.createElement('section')
            node.dataset.payloadBlockId = addition.id
            node.dataset.draftBlock = ''
            node.className = styles.draftBlock
            const label = root.createElement('p')
            label.className = styles.draftLabel
            label.textContent = `${session.snapshot.blockTypes?.[path]?.find((type) => type.slug === addition.blockType)?.label || addition.blockType} · Draft preview`
            node.append(label)
            for (const [fieldPath, field] of Object.entries(session.snapshot.fields)) {
              if (!fieldPath.startsWith(prefix) || field.type === 'array') {
                continue
              }
              // Optional empty text remains available in the sidebar without crowding the canvas.
              if (
                (field.type === 'text' || field.type === 'textarea') &&
                !field.value &&
                !/\.(?:heading|title)$/.test(fieldPath)
              ) {
                continue
              }
              const element = root.createElement(
                field.type === 'upload'
                  ? 'img'
                  : /\.(?:heading|title)$/.test(fieldPath)
                    ? 'h2'
                    : 'p',
              )
              element.dataset.payloadPath = fieldPath
              element.dataset.payloadType = field.type
              if (element instanceof HTMLImageElement) {
                element.src = placeholder
                element.alt = 'Choose image'
              } else {
                element.textContent =
                  field.type === 'richText'
                    ? textContent(field.value)
                    : typeof field.value === 'string'
                      ? field.value
                      : ''
              }
              node.append(element)
            }
            if (node.children.length === 1) {
              const hint = root.createElement('p')
              hint.textContent = 'Select this block to add content.'
              node.append(hint)
            }
            list.append(node)
            nodes.set(nodeKey, node)
          }
          for (const element of node.querySelectorAll<HTMLElement>(
            '[data-payload-type="richText"]',
          )) {
            const fieldPath = element.dataset.payloadPath!
            element.textContent = textContent(
              session.changes[fieldPath] ?? session.snapshot.fields[fieldPath]?.value,
            )
          }
        }
      }
      for (const [key, node] of nodes) {
        if (!retained.has(key)) {
          node.remove()
          nodes.delete(key)
        }
      }
    },
  }
}
