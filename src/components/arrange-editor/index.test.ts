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
