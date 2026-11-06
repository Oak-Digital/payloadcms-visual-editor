import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { SharedContentEditor } from './index.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

it('retains edits on collapse and failed saves, and freezes fields during persistence', async () => {
  vi.useFakeTimers()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let finishSave: ((response: Response) => void) | undefined
  const snapshot = (flag: boolean) => ({
    revision: 'one',
    drafts: true,
    status: 'published',
    document: { flag },
    nodes: [{ path: 'flag', label: 'Enabled', type: 'checkbox', value: flag }],
  })
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    if (request.action === 'save')
      return new Promise<Response>((resolve) => {
        finishSave = resolve
      })
    return Response.json(snapshot(request.action === 'preview'))
  })
  const props = {
    target: { slug: 'settings', global: true, label: 'Settings' },
    apiRoute: '/api',
    onClose: vi.fn(),
    onCollapse: vi.fn(),
    onPreview: vi.fn(),
    onSaved: vi.fn(),
    onStateChange: vi.fn(),
    onOpen: vi.fn(),
    enabledSources: [],
  }
  const render = async (hidden = false) => {
    await act(async () => root.render(createElement(SharedContentEditor, { ...props, hidden })))
  }
  try {
    await render()
    await act(async () => container.querySelector<HTMLInputElement>('input')!.click())
    await act(async () => vi.advanceTimersByTimeAsync(300))
    await render(true)
    await render(false)
    expect(container.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
    const save = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Save draft',
    )!
    await act(async () => save.click())
    expect(container.querySelector('[inert]')).not.toBeNull()
    await act(async () =>
      finishSave!(Response.json({ error: 'Conflict; edits retained' }, { status: 409 })),
    )
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Conflict')
    expect(container.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
    expect(save.disabled).toBe(false)
    expect(props.onSaved).not.toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    container.remove()
    fetcher.mockRestore()
    vi.useRealTimers()
  }
})
