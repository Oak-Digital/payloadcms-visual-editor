'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { FieldLayout } from '../../utils/field-layout.js'

import styles from './styles.module.scss'

export function SchemaFields({
  activePath,
  nodes,
  onOpen,
  renderCollection,
  renderField,
  visible,
}: {
  activePath?: string
  nodes: FieldLayout[]
  onOpen: (node: FieldLayout) => void
  renderCollection?: (node: FieldLayout) => ReactNode
  renderField: (node: FieldLayout) => ReactNode
  visible: (node: FieldLayout) => boolean
}) {
  const [sections, setSections] = useState<Record<string, string>>({})
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!activePath) {
      return
    }
    const contains = (node: FieldLayout): boolean =>
      node.path === activePath || Boolean(node.children?.some(contains))
    const selected: Record<string, string> = {}
    const visit = (nodes: FieldLayout[]) => {
      for (const node of nodes) {
        if (node.type === 'tabs') {
          const tab = node.children?.find(contains)
          if (tab) {
            selected[node.path] = tab.path
          }
        }
        if (node.children) {
          visit(node.children)
        }
      }
    }
    visit(nodes)
    setSections((current) => ({ ...current, ...selected }))
    const frame = requestAnimationFrame(() => {
      const leaf = [
        ...(root.current?.querySelectorAll<HTMLElement>('[data-layout-leaf]') ?? []),
      ].find((element) => element.dataset.layoutLeaf === activePath)
      let parent = leaf?.parentElement
      while (parent && parent !== root.current) {
        if (parent.tagName === 'DETAILS') {
          ;(parent as HTMLDetailsElement).open = true
        }
        parent = parent.parentElement
      }
      leaf
        ?.querySelector<HTMLElement>('input, textarea, select, button')
        ?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [activePath, nodes])
  const available = (node: FieldLayout): boolean =>
    node.children ? node.children.some(available) || visible(node) : visible(node)
  const render = (list: FieldLayout[]): ReactNode =>
    list.filter(available).map((node) => {
      if (['array', 'blocks', 'item'].includes(node.type)) {
        return (
          <div key={node.path}>
            {renderCollection && node.type !== 'item' ? (
              renderCollection(node)
            ) : (
              <button
                className={styles.item}
                data-layout-path={node.path}
                onClick={() => onOpen(node)}
                title={node.label}
                type="button"
              >
                <span>
                  <strong>{node.label}</strong>
                  {node.type !== 'item' && <small>{node.children?.length ?? 0} items</small>}
                </span>
                <span aria-hidden="true">›</span>
              </button>
            )}
          </div>
        )
      }
      if (node.type === 'tabs') {
        const tabs = node.children!.filter(available)
        const selected = tabs.find((tab) => tab.path === sections[node.path]) ?? tabs[0]
        return (
          <section className={styles.section} key={node.path}>
            <div aria-label="Sections" className={styles.tabs}>
              {tabs.map((tab) => (
                <button
                  aria-pressed={tab === selected}
                  key={tab.path}
                  onClick={() => setSections((all) => ({ ...all, [node.path]: tab.path }))}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {selected && render(selected.children!)}
          </section>
        )
      }
      if (node.type === 'collapsible') {
        return (
          <details
            aria-label={node.label || undefined}
            className={styles.section}
            key={node.path}
            open={!node.collapsed}
          >
            <summary title={node.label}>{node.label || 'Content'}</summary>
            {render(node.children ?? [])}
          </details>
        )
      }
      if (node.children) {
        return (
          <section
            aria-label={node.label || undefined}
            className={node.type === 'row' ? styles.row : styles.section}
            key={node.path}
          >
            {node.label && node.type !== 'row' && <h3 title={node.label}>{node.label}</h3>}
            {render(node.children)}
          </section>
        )
      }
      return (
        <div className={styles.field} data-layout-leaf={node.path} key={node.path}>
          {renderField(node)}
        </div>
      )
    })
  return (
    <div className={styles.fields} ref={root}>
      {render(nodes)}
    </div>
  )
}
