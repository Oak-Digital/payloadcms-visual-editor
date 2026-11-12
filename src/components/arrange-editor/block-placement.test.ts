import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArrangeEditor } from './index.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.mock('../../hooks/use-preview-refresh.js', () => ({ usePreviewRefresh: () => vi.fn() }))
vi.mock('../media-picker/index.js', () => ({ MediaPicker: () => null }))
vi.mock('../rich-text-editor/dialog.js', () => ({ RichTextDialog: () => null }))
vi.mock('../revision-history/index.js', () => ({ RevisionHistory: () => null }))

let root: ReturnType<typeof createRoot>
let panel: HTMLElement
let rejectAddition = false
let requests: Record<string, any>[]
const scroll = vi.fn()

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  HTMLElement.prototype.scrollIntoView = scroll
  scroll.mockClear()
  rejectAddition = false
  requests = []
})
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mount(ids = ['a', 'b'], max = 4) {
  document.body.innerHTML = `<main data-payload-block-list="layout">${ids.map((id) => `<section data-payload-block-id="${id}"></section>`).join('')}</main><main data-payload-block-list="secondary"><section data-payload-block-id="other"></section></main><div id="root"></div><div id="panel"></div><div id="history" data-feedback-toolbar></div>`
  panel = document.getElementById('panel')!
  root = createRoot(document.getElementById('root')!)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    requests.push(body)
    const additions =
      body.orders?.find((order: { path: string }) => order.path === 'layout')?.additions ?? []
    if (rejectAddition && additions.length)
      return Response.json({ error: 'Unable to prepare block' }, { status: 500 })
    return Response.json({
      revision: 'revision',
      fields: Object.fromEntries(
        additions.map((_: unknown, index: number) => [
          `layout.${ids.length + index}.heading`,
          { type: 'text', value: 'Section' },
        ]),
      ),
      layout: [
        {
          path: 'layout',
          type: 'blocks',
          label: 'Main content',
          children: additions.map((_: unknown, index: number) => ({
            path: `layout.${ids.length + index}`,
            type: 'item',
            label: 'Section',
            children: [
              { path: `layout.${ids.length + index}.heading`, type: 'text', label: 'Heading' },
            ],
          })),
        },
      ],
      orders: {
        layout: ids.map((id) => ({
          id,
          label: id === 'a' ? 'First' : 'Second',
          blockType: 'section',
        })),
        secondary: [{ id: 'other', label: 'Other list', blockType: 'section' }],
      },
      blockTypes: { layout: [{ slug: 'section', label: 'Section' }] },
      blockLimits: { layout: { min: 0, max } },
    })
  })
  await act(async () =>
    root.render(
      createElement(ArrangeEditor, {
        active: true,
        adminRoute: '/admin',
        apiRoute: '/api',
        documentInfo: { id: 'placement-test', collection: 'pages', hasDrafts: true },
        panelContainer: panel,
        historyContainer: document.getElementById('history')!,
        onClose: vi.fn(),
      }),
    ),
  )
}

function button(
  label: string,
  parent: ParentNode = ['Undo', 'Redo'].includes(label)
    ? document.getElementById('history')!
    : panel,
) {
  const found = [...parent.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.getAttribute('aria-label') === label || button.textContent === label,
  )!
  expect(found, label).toBeTruthy()
  return found
}
async function click(label: string) {
  expect(button(label).disabled).toBe(false)
  await act(async () => button(label).click())
}
async function choose() {
  await click('Add block to Main content')
  await click('Add Section')
}
function placements() {
  return [...panel.querySelectorAll<HTMLButtonElement>('[aria-label="Block placement"] button')]
}
function canvasOrder() {
  return [...document.querySelector('[data-payload-block-list="layout"]')!.children]
    .filter((element) => (element as HTMLElement).style.display !== 'none')
    .sort((a, b) => Number((a as HTMLElement).style.order) - Number((b as HTMLElement).style.order))
    .map((element) => (element as HTMLElement).dataset.payloadBlockId)
}

it.each([0, 1, 2])(
  'places a block at position %i in one undoable change and opens its controls',
  async (index) => {
    await mount()
    await choose()
    expect(requests).toHaveLength(1)
    expect(placements()).toHaveLength(3)
    expect(panel.textContent).not.toContain('Other list')
    expect(panel.querySelector('h2')?.textContent).toBe('Place Section')
    expect(panel.ownerDocument.activeElement).toBe(panel.querySelector('h2'))
    expect(button('Undo').disabled).toBe(true)
    await act(async () => placements()[index].click())
    const order = requests.at(-1)!.orders.find((order: { path: string }) => order.path === 'layout')
    const id = order.additions[0].id
    const expected = ['a', 'b']
    expected.splice(index, 0, id)
    expect(order.ids).toEqual(expected)
    expect(canvasOrder()).toEqual(expected)
    expect(panel.querySelector('h2')?.textContent).toBe('Section')
    expect(panel.querySelector('[aria-label="Block fields"]')).toBeTruthy()
    expect(scroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
    expect(requests.every((request) => request.action === 'read')).toBe(true)
    await click('Undo')
    expect(canvasOrder()).toEqual(['a', 'b'])
    expect(button('Undo').disabled).toBe(true)
    await click('Redo')
    expect(canvasOrder()).toEqual(expected)
  },
)

it('returns to the chooser with Back and cancels with Escape without an edit or request', async () => {
  await mount()
  await choose()
  await click('Back')
  expect(button('Add Section')).toBeTruthy()
  await click('Add Section')
  await act(async () => {
    placements()[0].focus()
    placements()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
  })
  expect(document.activeElement).toBe(placements()[1])
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
    ),
  )
  expect(document.activeElement).toBe(placements()[2])
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  )
  expect(button('Add block to Main content')).toBeTruthy()
  expect(document.activeElement).toBe(panel.querySelector('h2'))
  expect(canvasOrder()).toEqual(['a', 'b'])
  expect(requests).toHaveLength(1)
  expect(button('Undo').disabled).toBe(true)
})

it('offers one position in an empty list and respects the row limit after insertion', async () => {
  await mount([], 1)
  await choose()
  expect(placements()).toHaveLength(1)
  await click('Place here as first block')
  expect(canvasOrder()).toHaveLength(1)
  await click('Back')
  expect(button('Add block to Main content').disabled).toBe(true)
})

it('places against the pending order and preserves earlier rearrangement and removal on undo', async () => {
  await mount()
  await click('Rearrange')
  await click('Move Second up')
  await click('Edit')
  await click('Edit First')
  await click('Remove block')
  await choose()
  expect(placements()).toHaveLength(2)
  expect(placements()[0].getAttribute('aria-label')).toContain('Second')
  await act(async () => placements()[0].click())
  expect(canvasOrder()[1]).toBe('b')
  expect(canvasOrder()).toHaveLength(2)
  await click('Undo')
  expect(canvasOrder()).toEqual(['b'])
  await click('Undo')
  expect(canvasOrder()).toEqual(['b', 'a'])
})

it('keeps the chosen type and positions after a failed preparation and can retry', async () => {
  await mount()
  await choose()
  rejectAddition = true
  await act(async () => placements()[1].click())
  expect(panel.textContent).toContain('Unable to prepare block')
  expect(panel.querySelector('h2')?.textContent).toBe('Place Section')
  expect(canvasOrder()).toEqual(['a', 'b'])
  expect(button('Undo').disabled).toBe(true)
  rejectAddition = false
  await act(async () => placements()[1].click())
  expect(canvasOrder()).toHaveLength(3)
  expect(canvasOrder()[0]).toBe('a')
  expect(canvasOrder()[2]).toBe('b')
})
