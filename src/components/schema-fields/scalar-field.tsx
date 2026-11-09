'use client'

import { useId } from 'react'

import { AutoSizeTextarea } from '../auto-size-textarea/index.js'
import styles from './styles.module.scss'

export const scalarFieldTypes = [
  'text',
  'textarea',
  'email',
  'number',
  'checkbox',
  'radio',
  'select',
]

export function ScalarField({
  type,
  disabled,
  hasMany,
  label,
  onChange,
  options = [],
  value,
}: {
  disabled?: boolean
  hasMany?: boolean
  label: string
  onChange: (value: unknown) => void
  options?: { label: string; value: string }[]
  type: string
  value: unknown
}) {
  const name = useId()
  if (type === 'checkbox') {
    return (
      <label className={styles.choice}>
        <input
          aria-label={label}
          checked={value === true}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          type="checkbox"
        />
        {label}
      </label>
    )
  }
  if (type === 'radio' || hasMany) {
    return (
      <fieldset className={styles.choices} disabled={disabled}>
        <legend>{label}</legend>
        {options.map((option) => (
          <label className={styles.choice} key={option.value}>
            <input
              aria-label={option.label}
              checked={
                hasMany
                  ? Array.isArray(value) && value.includes(option.value)
                  : value === option.value
              }
              name={name}
              onChange={(e) =>
                onChange(
                  hasMany
                    ? options
                        .filter((o) =>
                          o.value === option.value
                            ? e.target.checked
                            : Array.isArray(value) && value.includes(o.value),
                        )
                        .map((o) => o.value)
                    : option.value,
                )
              }
              type={hasMany ? 'checkbox' : 'radio'}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    )
  }
  return (
    <label className={styles.control}>
      <span>{label}</span>
      {type === 'select' ? (
        <select
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          value={typeof value === 'string' ? value : ''}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === 'textarea' ? (
        <AutoSizeTextarea
          aria-label={label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          value={typeof value === 'string' ? value : ''}
        />
      ) : (
        <input
          aria-label={label}
          disabled={disabled}
          onChange={(e) =>
            onChange(
              type === 'number'
                ? e.target.value === ''
                  ? null
                  : e.target.valueAsNumber
                : e.target.value,
            )
          }
          type={type === 'number' ? 'number' : type === 'email' ? 'email' : 'text'}
          value={typeof value === 'string' || typeof value === 'number' ? value : ''}
        />
      )}
    </label>
  )
}
