import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ArrangeEditor } from './index.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.mock('../../hooks/use-preview-refresh.js', () => ({ usePreviewRefresh: () => vi.fn() }))
vi.mock('../media-picker/index.js', () => ({ MediaPicker: () => null }))
vi.mock('../rich-text-editor/dialog.js', () => ({ RichTextDialog: () => null }))
vi.mock('../revision-history/index.js', () => ({ RevisionHistory: () => null }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

it('separates rearranging from editing and locates the selected block after moving it', async () => {
  document.body.innerHTML =
    '<main data-payload-block-list="layout"><section data-payload-block-id="a"></section><section data-payload-block-id="b"></section></main><div id="editor"></div>'
  const container = document.getElementById('editor')!
  const root = createRoot(container)
  const scroll = vi.fn()
  const block = document.querySelector('[data-payload-block-id="b"]')!
  block.scrollIntoView = scroll
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        fields: {},
        orders: {
          layout: [
            { id: 'a', label: 'First' },
            { id: 'b', label: 'Second' },
          ],
        },
      }),
    ),
  )
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === label || button.textContent === label,
    )!
    expect(button).toBeTruthy()
    await act(async () => button.click())
  }
  try {
    await act(async () =>
      root.render(
        createElement(ArrangeEditor, {
          active: true,
          adminRoute: '/admin',
          apiRoute: '/api',
          documentInfo: { id: 'page', collection: 'pages', hasDrafts: true },
          onClose: vi.fn(),
        }),
      ),
    )
    expect(container.querySelector('[aria-label="Editor menu"]')).toBeTruthy()
    expect(container.querySelector('ol')).toBeNull()
    await click('Edit content›')
    expect(container.querySelector('[aria-label="Edit Second"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Move Second up"]')).toBeNull()
    await click('Back')
    await click('Rearrange content›')
    expect(container.querySelector('[aria-label="Edit Second"]')).toBeNull()
    await click('Move Second up')
    expect(scroll).not.toHaveBeenCalled()
    await click('Back')
    await click('Edit content›')
    expect(container.querySelector('ol button')?.textContent).toContain('Second')
    await click('Edit Second')
    expect(scroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
    await click('Back')
    expect(container.querySelector('ol button')?.textContent).toContain('Second')
  } finally {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

it('keeps workspace drafts and save actions mounted while hidden and rejects unrelated frame messages', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.innerHTML =
    '<main><h1 data-payload-path="title">Original</h1></main><div id="editor"></div><div id="panel"></div><div id="heading"></div><div id="actions"></div><div id="history" data-feedback-toolbar></div>'
  const root = createRoot(document.getElementById('editor')!)
  const panel = document.getElementById('panel')!
  const heading = document.getElementById('heading')!
  const actions = document.getElementById('actions')!
  const reveal = vi.fn()
  const home = vi.fn()
  const pending = vi.fn()
  const props = {
    active: true,
    adminRoute: '/admin',
    apiRoute: '/api',
    documentInfo: { id: 'page', collection: 'pages', hasDrafts: true },
    panelContainer: panel,
    headerContainer: heading,
    actionsContainer: actions,
    historyContainer: document.getElementById('history')!,
    onClose: vi.fn(),
    onHome: home,
    onReveal: reveal,
    onPendingChange: pending,
  }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ fields: { title: { type: 'text', value: 'Original' } }, orders: {} }),
    ),
  )
  const message = async (
    data: Record<string, unknown>,
    origin = window.location.origin,
    source: MessageEventSource | null = window.parent,
  ) => {
    await act(async () =>
      window.dispatchEvent(new MessageEvent('message', { data, origin, source })),
    )
  }
  try {
    await act(async () => root.render(createElement(ArrangeEditor, props)))
    await act(async () => (document.querySelector('h1') as HTMLElement).click())
    expect(reveal).toHaveBeenCalled()
    const input = panel.querySelector('textarea')!
    expect(input.value).toBe('Original')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        'Pending draft',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('h1')?.textContent).toBe('Pending draft')
    expect(actions.querySelector('button')?.disabled).toBe(false)
    await message({ type: 'visual-editor:show', view: 'changes' }, 'https://unrelated.example')
    expect(panel.querySelector('textarea')).toBe(input)
    await message({ type: 'visual-editor:show', view: 'changes' }, window.location.origin, null)
    expect(panel.querySelector('textarea')).toBe(input)
    // Browsing and collapsing hide the host, without unmounting the field or action portals.
    await act(async () => {
      panel.hidden = true
      root.render(createElement(ArrangeEditor, { ...props, active: false }))
    })
    expect(panel.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('Pending draft')
    expect(actions.querySelector('button')?.disabled).toBe(false)
    await act(async () => {
      panel.hidden = false
      root.render(createElement(ArrangeEditor, props))
    })
    expect(input.value).toBe('Pending draft')
    await act(async () =>
      (document.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(),
    )
    expect(input.value).toBe('Original')
    expect(document.querySelector('h1')?.textContent).toBe('Original')
    expect(actions.querySelector('button')?.disabled).toBe(true)
    await act(async () => root.render(createElement(ArrangeEditor, { ...props, active: false })))
    await act(async () => root.render(createElement(ArrangeEditor, props)))
    await act(async () =>
      (document.querySelector('[aria-label="Redo"]') as HTMLButtonElement).click(),
    )
    expect(input.value).toBe('Pending draft')
    expect(actions.querySelector('button')?.disabled).toBe(false)
    await message({ type: 'visual-editor:show', view: 'changes' })
    expect(panel.querySelector('details')?.open).toBe(true)
    expect(panel.textContent).toContain('Pending draft')
    await message({ type: 'visual-editor:back' })
    expect(home).toHaveBeenCalled()
    expect(pending).toHaveBeenLastCalledWith(true, false, 1, '', 0)
  } finally {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  }
})
