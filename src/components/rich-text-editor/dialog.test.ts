import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import { RichTextDialog } from './dialog.js'

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }))
vi.mock('../../hooks/use-preview-refresh.js', () => ({ usePreviewRefresh: () => refresh }))
vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

it('keeps saved rich text open after refresh failure and retries without saving again', async () => {
  HTMLDialogElement.prototype.showModal = vi.fn()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onClose = vi.fn()
  refresh.mockRejectedValueOnce(new Error('Preview timed out')).mockResolvedValue(undefined)
  try {
    await act(() =>
      root.render(
        createElement(RichTextDialog, {
          adminRoute: '/admin',
          documentInfo: { collection: 'pages', id: 'page', hasDrafts: true },
          path: 'layout.0.body',
          onClose,
        }),
      ),
    )
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        source: container.querySelector('iframe')!.contentWindow,
        data: { type: 'payload-visual-editor:saved' },
      }),
    )
    await act(() => container.querySelector('button')!.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Preview timed out')
    expect(onClose).not.toHaveBeenCalled()
    expect(container.querySelector('button')?.textContent).toBe('Retry preview update')
    await act(() => container.querySelector('button')!.click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledTimes(2)
  } finally {
    await act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  }
})
