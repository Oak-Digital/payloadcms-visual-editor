import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { RichTextSidebar } from './sidebar.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
let root: ReturnType<typeof createRoot>
let container: HTMLDivElement

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

it('preserves structured values, ignores unrelated frames, and synchronizes undo without echoing typing', async () => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  const original = { root: { children: [{ type: 'text', format: 1, text: 'Bold' }] } }
  const edited = { root: { children: [{ type: 'text', format: 1, text: 'Bold edit' }] } }
  const onChange = vi.fn()
  const render = async (value: unknown, disabled = false) => {
    await act(async () =>
      root.render(
        createElement(RichTextSidebar, {
          adminRoute: '/admin',
          disabled,
          documentInfo: { id: 'one', collection: 'pages', hasDrafts: true },
          onChange,
          path: 'layout.0.richText',
          value,
        }),
      ),
    )
  }
  await render(original)
  const frame = container.querySelector('iframe')!
  const post = vi.spyOn(frame.contentWindow!, 'postMessage')
  const send = async (
    type: string,
    value?: unknown,
    source = frame.contentWindow,
    origin = window.location.origin,
  ) => {
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', { data: { type, value }, origin, source }))
    })
  }
  await send('payload-visual-editor:ready')
  expect(post).toHaveBeenLastCalledWith(
    { type: 'payload-visual-editor:initial', value: original },
    window.location.origin,
  )
  await send('payload-visual-editor:changed', edited, window)
  await send(
    'payload-visual-editor:changed',
    edited,
    frame.contentWindow,
    'https://untrusted.example',
  )
  expect(onChange).not.toHaveBeenCalled()
  await send('payload-visual-editor:changed', edited)
  expect(onChange).toHaveBeenCalledWith(edited)
  await render(edited)
  expect(post).toHaveBeenCalledTimes(1)
  await render(original)
  expect(post).toHaveBeenCalledTimes(2)
  await render(original, true)
  await send('payload-visual-editor:changed', edited)
  expect(onChange).toHaveBeenCalledTimes(1)
  expect(container.querySelector('iframe')).toBe(frame)
})
