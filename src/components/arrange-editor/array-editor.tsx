'use client'

import { useState } from 'react'
import type { ArrangeArrayField, ArrayRow } from '../../utils/arrange.js'
import styles from './styles.module.scss'

export function ArrayEditor({
  field,
  value,
  disabled,
  onChange,
}: {
  field: ArrangeArrayField
  value: ArrayRow[]
  disabled: boolean
  onChange: (rows: ArrayRow[]) => void
}) {
  const [choice, setChoice] = useState('')
  const move = (index: number, destination: number) => {
    const rows = [...value]
    const [row] = rows.splice(index, 1)
    rows.splice(destination, 0, row)
    onChange(rows)
  }
  return (
    <section aria-label={field.label}>
      <h3>{field.label}</h3>
      <ol className={styles.pending}>
        {value.map((row, index) => (
          <li key={'id' in row ? row.id : `new-${index}`}>
            <span>
              {'id' in row
                ? field.labels[row.id]
                : field.choices.find((choice) => choice.id === row.relationship)?.label}
            </span>
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
              disabled={disabled || value.length <= field.minRows}
              onClick={() => onChange(value.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
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
        }}
      >
        Add product
      </button>
    </section>
  )
}
