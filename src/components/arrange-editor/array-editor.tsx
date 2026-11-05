'use client'

import { useState } from 'react'
import type { ArrangeArrayField, ArrayRow } from '../../utils/arrange.js'
import styles from './styles.module.scss'

export function ArrayEditor({
  field,
  value,
  disabled,
  onChange,
  onSelectRow,
}: {
  field: ArrangeArrayField
  value: ArrayRow[]
  disabled: boolean
  onChange: (rows: ArrayRow[]) => void
  onSelectRow: (id: string) => void
}) {
  const [choice, setChoice] = useState('')
  const [adding, setAdding] = useState(false)
  const move = (index: number, destination: number) => {
    const rows = [...value]
    const [row] = rows.splice(index, 1)
    rows.splice(destination, 0, row)
    onChange(rows)
  }
  return (
    <section aria-label={field.label}>
      <ol className={styles.productRows}>
        {value.map((row, index) => (
          <li key={'id' in row ? row.id : `new-${index}`}>
            <button
              className={styles.blockSelect}
              title={
                'id' in row
                  ? field.labels[row.id]
                  : field.choices.find((choice) => choice.id === row.relationship)?.label
              }
              type="button"
              disabled={disabled || !('id' in row)}
              onClick={() => {
                if ('id' in row) onSelectRow(row.id)
              }}
            >
              {'id' in row
                ? field.labels[row.id]
                : field.choices.find((choice) => choice.id === row.relationship)?.label}
            </button>
            <button
              type="button"
              aria-label={`Move product ${index + 1} up`}
              disabled={disabled || index === 0}
              onClick={() => move(index, index - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move product ${index + 1} down`}
              disabled={disabled || index === value.length - 1}
              onClick={() => move(index, index + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Remove product ${index + 1}`}
              title="Remove product"
              disabled={disabled || value.length <= field.minRows}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
              </svg>
            </button>
          </li>
        ))}
      </ol>
      {!adding ? (
        <button
          type="button"
          disabled={disabled || (field.maxRows !== undefined && value.length >= field.maxRows)}
          className={styles.addProduct}
          onClick={() => setAdding(true)}
        >
          Add product
        </button>
      ) : (
        <div className={styles.addProduct}>
          <label>
            Product to add
            <select
              value={choice}
              disabled={disabled}
              onChange={(event) => setChoice(event.target.value)}
            >
              <option value="">Select a product</option>
              {field.choices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={
              disabled || !choice || (field.maxRows !== undefined && value.length >= field.maxRows)
            }
            onClick={() => {
              onChange([...value, { relationship: choice }])
              setChoice('')
              setAdding(false)
            }}
          >
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  )
}
