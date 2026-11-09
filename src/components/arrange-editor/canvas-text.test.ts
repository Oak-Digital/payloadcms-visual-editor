import { afterEach, expect, it, vi } from 'vitest'
import { createCanvasTextEditor, type CanvasTextField } from './canvas-text.js'

afterEach(() => {
  document.body.replaceChildren()
})

function fixture() {
  document.body.innerHTML =
    '<h1 data-payload-path="heading"><span>Original</span> title</h1><p data-payload-path="body">Body</p><div data-payload-path="rich">Formatted</div>'
  const element = document.querySelector('h1')!
  const span = element.firstChild!
  const text = span.firstChild!
  const editor = createCanvasTextEditor(document)
  const field: CanvasTextField = {
    key: 'page',
    path: 'heading',
    label: 'Heading',
    value: 'Original title',
    changed: false,
    multiline: false,
  }
  const options = {
    enabled: true,
    blocked: false,
    refreshing: false,
    resolve: (node: HTMLElement) => (node === element ? field : undefined),
    onSelect: vi.fn(),
    onChange: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  }
  editor.update(options)
  return { element, span, text, editor, field, options }
}

it('keeps the caret during synchronized edits and restores the exact React-owned nodes before refreshing', () => {
  const { element, span, text, editor, field, options } = fixture()
  try {
    expect(element.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(
      document.querySelector('[data-payload-path="rich"]')?.hasAttribute('contenteditable'),
    ).toBe(false)
    element.focus()
    expect(options.onSelect).toHaveBeenCalledWith(field)
    text.nodeValue = 'Changed'
    const range = document.createRange()
    range.setStart(text, 3)
    range.collapse(true)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(options.onChange).toHaveBeenCalledWith(field, 'Changed title')
    field.value = 'Changed title'
    field.changed = true
    editor.update(options)
    expect(document.getSelection()?.anchorNode).toBe(text)
    expect(document.getSelection()?.anchorOffset).toBe(3)
    expect(element.firstChild).toBe(span)
    // A sidebar change/undo is reflected in the same canvas node.
    field.value = 'Sidebar edit'
    editor.update(options)
    expect(element.textContent).toBe('Sidebar edit')
    element.replaceChildren(document.createTextNode('Browser replaced children'))
    editor.update({ ...options, refreshing: true })
    expect(element.firstChild).toBe(span)
    expect(span.firstChild).toBe(text)
    expect(element.textContent).toBe('Original title')
    expect(element.hasAttribute('contenteditable')).toBe(false)
  } finally {
    editor.destroy()
  }
})

it('stages composition once and routes keyboard undo/redo to shared history', () => {
  const { element, editor, options } = fixture()
  try {
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    element.textContent = '入力'
    element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }))
    expect(options.onChange).not.toHaveBeenCalled()
    editor.update(options)
    expect(element.textContent).toBe('入力')
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
    expect(options.onChange).toHaveBeenCalledTimes(1)
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true, bubbles: true }),
    )
    expect(options.onUndo).toHaveBeenCalledTimes(1)
    expect(options.onRedo).toHaveBeenCalledTimes(1)
    editor.update({ ...options, blocked: true })
    expect(element.hasAttribute('contenteditable')).toBe(false)
    element.dispatchEvent(new InputEvent('input', { bubbles: true }))
    expect(options.onChange).toHaveBeenCalledTimes(1)
  } finally {
    editor.destroy()
  }
})

it('edits canonical text in decorated headings without saving duplicated animation glyphs', () => {
  const { element, editor, field, options } = fixture()
  try {
    editor.destroy()
    element.innerHTML = '<span>A </span><span aria-hidden="true">TTiimmee</span><span>piece</span>'
    const decorated = createCanvasTextEditor(document)
    field.value = 'A Timepiece'
    try {
      decorated.update(options)
      element.focus()
      expect(element.textContent).toBe('A Timepiece')
      decorated.update(options)
      expect(element.textContent).toBe('A Timepiece')
      element.blur()
      expect(element.querySelector('[aria-hidden]')?.textContent).toBe('TTiimmee')
    } finally {
      decorated.destroy()
    }
  } finally {
    editor.destroy()
  }
})
