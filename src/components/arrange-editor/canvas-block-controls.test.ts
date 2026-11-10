import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { documentKey } from '../../utils/field-target.js'
import { CanvasBlockControls } from './canvas-block-controls.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

it('moves mapped blocks with arrows and keyboard, respects boundaries and cleans up when inactive', async () => {
  document.body.innerHTML =
    '<main data-payload-block-list="layout"><section data-payload-block-id="a"></section><section data-payload-block-id="b"></section><section data-payload-block-id="unknown"></section></main><div id="editor"></div>'
  const owner = { id: 'page', collection: 'pages', hasDrafts: true }
  const key = documentKey(owner)
  const onMove = vi.fn()
  const lists = [
    {
      key,
      path: 'layout',
      rows: [
        { id: 'a', label: 'First' },
        { id: 'b', label: 'Second' },
      ],
    },
  ]
  const root = createRoot(document.getElementById('editor')!)
  const render = async (active: boolean, epoch = 0) =>
    act(async () =>
      root.render(createElement(CanvasBlockControls, { active, epoch, owner, lists, onMove })),
    )
  await render(true)
  const button = (label: string) =>
    document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!
  expect(button('Move First up').disabled).toBe(true)
  expect(button('Move Second down').disabled).toBe(true)
  expect(document.querySelector('[data-payload-block-id="unknown"]')!.children).toHaveLength(0)
  await act(async () => button('Move First down').click())
  expect(onMove).toHaveBeenLastCalledWith(key, 'layout', 'a', 1)
  await act(async () =>
    button('Drag Second to reorder. Use arrow keys to move.').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }),
    ),
  )
  expect(onMove).toHaveBeenLastCalledWith(key, 'layout', 'b', 0)
  expect(document.querySelector('[role="status"]')!.textContent).toContain(
    'Second moved to position 1 of 2',
  )
  const drag = new Event('dragstart', { bubbles: true })
  Object.defineProperty(drag, 'dataTransfer', { value: { setData: vi.fn(), effectAllowed: '' } })
  await act(async () =>
    button('Drag First to reorder. Use arrow keys to move.').dispatchEvent(drag),
  )
  await act(async () =>
    document
      .querySelector('[data-payload-block-id="b"]')!
      .dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })),
  )
  expect(onMove).toHaveBeenLastCalledWith(key, 'layout', 'a', 1)
  await render(true, 1)
  expect(document.querySelectorAll('[role="group"]')).toHaveLength(2)
  await render(false)
  expect(document.querySelectorAll('[role="group"], [data-arrange-block-controls]')).toHaveLength(0)
  await act(async () => root.unmount())
})
