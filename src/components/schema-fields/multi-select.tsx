'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import styles from './styles.module.scss'

export function MultiSelect({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean
  label: string
  onChange: (value: string[]) => void
  options: { label: string; value: string }[]
  value: unknown
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState<{
    bottom?: number
    left: number
    maxHeight: number
    top?: number
    width: number
  }>()
  const selected = options.filter((option) => Array.isArray(value) && value.includes(option.value))
  const summary = selected.map((option) => option.label).join(', ') || 'Select…'
  const open = Boolean(placement) && !disabled
  const close = (restoreFocus = false) => {
    setPlacement(undefined)
    if (restoreFocus) {
      trigger.current?.focus()
    }
  }
  const show = () => {
    const element = trigger.current
    const host = element?.ownerDocument.defaultView
    if (!element || !host || disabled) {
      return
    }
    const rect = element.getBoundingClientRect()
    const below = host.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const upwards = below < Math.min(240, options.length * 36 + 8) && above > below
    setPlacement({
      left: rect.left,
      width: rect.width,
      ...(upwards ? { bottom: host.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      maxHeight: Math.max(40, Math.min(240, upwards ? above : below)),
    })
  }
  useEffect(() => {
    if (!open) {
      return
    }
    const doc = trigger.current!.ownerDocument
    const dismiss = (event: Event) => {
      const target = event.target as Node | null
      if (target && !menu.current?.contains(target) && !trigger.current?.contains(target)) {
        setPlacement(undefined)
      }
    }
    const resize = () => setPlacement(undefined)
    doc.addEventListener('pointerdown', dismiss, true)
    doc.addEventListener('focusin', dismiss)
    doc.addEventListener('scroll', dismiss, true)
    doc.defaultView?.addEventListener('resize', resize)
    const first =
      menu.current?.querySelector<HTMLElement>('[aria-selected="true"]') ??
      menu.current?.querySelector<HTMLElement>('[role="option"]')
    if (first) {
      first.focus()
    } else {
      menu.current?.focus()
    }
    return () => {
      doc.removeEventListener('pointerdown', dismiss, true)
      doc.removeEventListener('focusin', dismiss)
      doc.removeEventListener('scroll', dismiss, true)
      doc.defaultView?.removeEventListener('resize', resize)
    }
  }, [open])
  useEffect(() => {
    if (disabled) {
      setPlacement(undefined)
    }
  }, [disabled])
  return (
    <div className={`${styles.control} ${styles.dropdown}`}>
      <label htmlFor={id}>{label}</label>
      <button
        aria-controls={open ? `${id}-options` : undefined}
        aria-describedby={`${id}-summary`}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className={styles.trigger}
        data-editor-dropdown-open={open || undefined}
        disabled={disabled}
        id={id}
        onClick={() => (open ? close() : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            show()
          }
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            close(true)
          }
        }}
        ref={trigger}
        role="combobox"
        type="button"
      >
        <span id={`${id}-summary`} title={summary}>
          {summary}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open &&
        trigger.current &&
        createPortal(
          <div
            aria-label={label}
            aria-multiselectable="true"
            className={styles.dropdownMenu}
            data-editor-dropdown-open="true"
            data-feedback-toolbar
            id={`${id}-options`}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                close(true)
                return
              }
              if (event.key === 'Tab') {
                close(true)
                return
              }
              const items = [
                ...menu.current!.querySelectorAll<HTMLButtonElement>('[role="option"]'),
              ]
              const current = items.indexOf(event.target as HTMLButtonElement)
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : event.key === 'ArrowDown'
                      ? (current + 1) % items.length
                      : event.key === 'ArrowUp'
                        ? (current - 1 + items.length) % items.length
                        : undefined
              if (next !== undefined) {
                event.preventDefault()
                items[next]?.focus()
              }
            }}
            ref={menu}
            role="listbox"
            style={placement}
            tabIndex={-1}
          >
            {options.length ? (
              options.map((option) => {
                const checked = selected.includes(option)
                return (
                  <button
                    aria-selected={checked}
                    key={option.value}
                    onClick={() =>
                      onChange(
                        options
                          .filter((item) =>
                            item.value === option.value ? !checked : selected.includes(item),
                          )
                          .map((item) => item.value),
                      )
                    }
                    role="option"
                    tabIndex={-1}
                    type="button"
                  >
                    <span aria-hidden="true" className={styles.checkmark}>
                      {checked ? '✓' : ''}
                    </span>
                    {option.label}
                  </button>
                )
              })
            ) : (
              <p>No options</p>
            )}
          </div>,
          trigger.current.closest('[data-visual-editor-workspace]') ??
            trigger.current.ownerDocument.body,
        )}
    </div>
  )
}
