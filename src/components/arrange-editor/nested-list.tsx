'use client'

import { useState } from 'react'
import styles from './styles.module.scss'

export function NestedList({
  label,
  rows,
  ids,
  types,
  max,
  disabled,
  onOpen,
  onMove,
  onAdd,
}: {
  label: string
  rows: { id: string; label: string }[]
  ids: string[]
  types: { slug: string; label: string }[]
  max?: number
  disabled: boolean
  onOpen: (id: string) => void
  onMove: (id: string, to: number) => void
  onAdd: (type: string) => void
}) {
  const [rearrange, setRearrange] = useState(false)
  const [choosing, setChoosing] = useState(false)
  const [dragged, setDragged] = useState<string>()
  return (
    <section className={styles.nestedList} aria-label={label}>
      <nav className={styles.blockModes} aria-label={`${label} mode`}>
        <button type="button" aria-pressed={!rearrange} onClick={() => setRearrange(false)}>
          Edit
        </button>
        <button type="button" aria-pressed={rearrange} onClick={() => setRearrange(true)}>
          Rearrange
        </button>
      </nav>
      <ol className={styles.blocks}>
        {ids.map((id, index) => {
          const title = rows.find((row) => row.id === id)?.label || `Item ${index + 1}`
          return (
            <li
              key={id}
              onDragOver={(event) => {
                if (rearrange && !disabled) event.preventDefault()
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragged && !disabled) onMove(dragged, index)
                setDragged(undefined)
              }}
            >
              {rearrange ? (
                <>
                  <button
                    className={styles.handle}
                    type="button"
                    draggable={!disabled}
                    disabled={disabled}
                    aria-label={`Drag ${title}`}
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', id)
                      event.dataTransfer.effectAllowed = 'move'
                      setDragged(id)
                    }}
                    onDragEnd={() => setDragged(undefined)}
                  >
                    ⠿
                  </button>
                  <span title={title}>{title}</span>
                  <button
                    type="button"
                    aria-label={`Move ${title} up`}
                    disabled={disabled || index === 0}
                    onClick={() => onMove(id, index - 1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${title} down`}
                    disabled={disabled || index === ids.length - 1}
                    onClick={() => onMove(id, index + 1)}
                  >
                    ↓
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className={styles.blockSelect}
                  disabled={disabled}
                  title={title}
                  onClick={() => onOpen(id)}
                >
                  <span>
                    <strong>{title}</strong>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              )}
            </li>
          )
        })}
      </ol>
      {!rearrange && (
        <button
          className={styles.addBlock}
          type="button"
          disabled={disabled || (max !== undefined && ids.length >= max)}
          onClick={() => (types.length === 1 ? onAdd(types[0].slug) : setChoosing(!choosing))}
        >
          Add {types.length === 1 ? types[0].label.toLowerCase() : 'item'}
        </button>
      )}
      {choosing &&
        types.map((type) => (
          <button
            key={type.slug}
            className={styles.fieldChoice}
            disabled={disabled}
            type="button"
            onClick={() => {
              onAdd(type.slug)
              setChoosing(false)
            }}
          >
            {type.label}
          </button>
        ))}
    </section>
  )
}
