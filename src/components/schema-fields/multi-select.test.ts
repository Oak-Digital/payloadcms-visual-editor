import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import { MultiSelect } from './multi-select.js'

it('keeps multiple selections while closing, reopening, using keys and clicking outside', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  container.setAttribute('data-visual-editor-workspace', '')
  document.body.append(container)
  const root = createRoot(container)
  const escaped = vi.fn()
  window.addEventListener('keydown', escaped)
  const options = [
    { label: 'One', value: 'one' },
    { label: 'Two', value: 'two' },
    { label: 'Three', value: 'three' },
  ]
  function Form() {
    const [value, setValue] = useState<string[]>([])
    return createElement(MultiSelect, { label: 'Choices', onChange: setValue, options, value })
  }
  const press = (key: string) =>
    act(() =>
      Promise.resolve(
        document.activeElement?.dispatchEvent(
          new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }),
        ),
      ),
    )
  try {
    await act(() => Promise.resolve(root.render(createElement(Form))))
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    await act(() => Promise.resolve(trigger.click()))
    let items = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    expect(container.contains(document.querySelector('[role="listbox"]'))).toBe(true)
    expect(document.activeElement).toBe(items[0])
    await act(() => Promise.resolve(items[0].click()))
    await press('ArrowDown')
    expect(document.activeElement).toBe(items[1])
    await act(() => Promise.resolve(items[1].click()))
    await press('Escape')
    expect(escaped).not.toHaveBeenCalled()
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    expect(trigger.textContent).toContain('One, Two')
    await press('ArrowDown')
    items = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
    expect(items.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'true', 'false'])
    await act(() => Promise.resolve(items[0].click()))
    expect(trigger.textContent).toContain('Two')
    await act(() =>
      Promise.resolve(document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))),
    )
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(trigger.textContent).toContain('Two')
  } finally {
    await act(() => Promise.resolve(root.unmount()))
    container.remove()
    window.removeEventListener('keydown', escaped)
    vi.unstubAllGlobals()
  }
})
