import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useDotPosition } from './use-dot-position.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

function mount() {
  let result!: ReturnType<typeof useDotPosition>
  function Test() {
    result = useDotPosition()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Test)))
  return { read: () => result, unmount: () => act(() => root.unmount()) }
}

it('remembers the selected corner when the workspace remounts', () => {
  const first = mount()
  expect(first.read()[0]).toBe('top-right')
  act(() => first.read()[1]('bottom-left'))
  first.unmount()
  const second = mount()
  expect(second.read()[0]).toBe('bottom-left')
  second.unmount()
})

it('ignores invalid saved placements', () => {
  localStorage.setItem('oak-visual-editor:dot-position', 'outside')
  const workspace = mount()
  expect(workspace.read()[0]).toBe('top-right')
  workspace.unmount()
})

it('keeps placement usable when storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const workspace = mount()
  act(() => workspace.read()[1]('bottom-right'))
  expect(workspace.read()[0]).toBe('bottom-right')
  workspace.unmount()
})
