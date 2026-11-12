'use client'

import { Fragment } from 'react'
import styles from './styles.module.scss'

export function BlockPlacement({
  rows,
  disabled,
  onPlace,
}: {
  rows: { id: string; label: string }[]
  disabled: boolean
  onPlace: (beforeId: string | null) => void
}) {
  return (
    <section
      aria-label="Block placement"
      className={styles.placement}
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
        const index = buttons.indexOf(event.target as HTMLButtonElement)
        if (index < 0) return
        event.preventDefault()
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : Math.max(
                  0,
                  Math.min(buttons.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                )
        buttons[next]?.focus()
      }}
    >
      {rows.map((row, index) => (
        <Fragment key={row.id}>
          <button
            type="button"
            className={styles.placeBlock}
            disabled={disabled}
            aria-label={`Place here before ${row.label} (position ${index + 1})`}
            onClick={() => onPlace(row.id)}
          >
            <span>＋ Place here</span>
          </button>
          <div className={styles.placementBlock} title={row.label}>
            {row.label}
          </div>
        </Fragment>
      ))}
      <button
        type="button"
        className={styles.placeBlock}
        disabled={disabled}
        aria-label={rows.length ? 'Place here at end' : 'Place here as first block'}
        onClick={() => onPlace(null)}
      >
        <span>＋ Place here</span>
      </button>
    </section>
  )
}
