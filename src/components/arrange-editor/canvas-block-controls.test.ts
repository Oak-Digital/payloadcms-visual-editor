import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { documentKey } from '../../utils/field-target.js'
import { CanvasBlockControls } from './canvas-block-controls.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
vi.stubGlobal('matchMedia', () => ({ matches: false }))

it('moves mapped blocks with arrows and keyboard, respects boundaries and cleans up when inactive', async () => {
  document.body.innerHTML =
    '<main data-payload-block-list="layout"><section data-payload-block-id="a"></section><section data-payload-block-id="b"></section><section data-payload-block-id="unknown"></section></main><div id="editor"></div>'
  const owner = { id: 'page', collection: 'pages', hasDrafts: true }
  const key = documentKey(owner)
  const onMove = vi.fn()
  const onEdit = vi.fn()
  const onComment = vi.fn()
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
      root.render(
        createElement(CanvasBlockControls, {
          active,
          epoch,
          owner,
          lists,
          onMove,
          onEdit,
          onComment,
        }),
      ),
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
  await act(async () => button('Edit First block').click())
  expect(onEdit).toHaveBeenCalledWith(key, 'layout', 'a')
  await act(async () => button('Comment on First').click())
  expect(onComment).toHaveBeenCalledWith(
    document.querySelector('[data-payload-block-id="a"]'),
    'First',
  )
  await act(async () => button('More actions for First').click())
  expect(document.body.textContent).toContain('Block 1 of 2')
  await act(async () =>
    button('More actions for First').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(button('More actions for First').getAttribute('aria-expanded')).toBe('false')
  const grip = button('Drag First to reorder. Use arrow keys to move.')
  const pointer = async (type: string, x: number, y: number) =>
    act(async () =>
      grip.dispatchEvent(
        new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }),
      ),
    )
  const point = vi.fn(() => document.querySelector('[data-payload-block-id="b"]'))
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: point })
  onMove.mockClear()
  await pointer('pointerdown', 10, 100)
  await pointer('pointermove', 20, 200)
  await pointer('pointerup', 20, 200)
  expect(onMove).toHaveBeenCalledExactlyOnceWith(key, 'layout', 'a', 1)
  onMove.mockClear()
  await pointer('pointerdown', 10, 100)
  await pointer('pointermove', 20, 200)
  await pointer('pointercancel', 20, 200)
  await pointer('pointerup', 20, 200)
  expect(onMove).not.toHaveBeenCalled()
  point.mockReturnValue(document.querySelector('[data-payload-block-id="unknown"]'))
  await pointer('pointerdown', 10, 100)
  await pointer('pointermove', 20, 200)
  await pointer('pointerup', 20, 200)
  expect(onMove).not.toHaveBeenCalled()
  await render(true, 1)
  expect(document.querySelectorAll('[role="group"]')).toHaveLength(2)
  await render(false)
  expect(document.querySelectorAll('[role="group"], [data-arrange-block-controls]')).toHaveLength(0)
  await act(async () => root.unmount())
})
