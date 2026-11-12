import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { useWorkspaceLayout } from './use-workspace-layout.js'

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

function mount() {
  let result!: ReturnType<typeof useWorkspaceLayout>
  function Test() {
    result = useWorkspaceLayout()
    return null
  }
  const root = createRoot(document.createElement('div'))
  act(() => root.render(createElement(Test)))
  return { read: () => result, unmount: () => act(() => root.unmount()) }
}

it('remembers layout and framing independently across workspace mounts', () => {
  const first = mount()
  expect(first.read()[0]).toEqual({ layout: 'floating', framed: false })
  act(() => first.read()[1]({ layout: 'sidebar' }))
  act(() => first.read()[1]({ framed: true }))
  first.unmount()
  const second = mount()
  expect(second.read()[0]).toEqual({ layout: 'sidebar', framed: true })
  act(() => second.read()[1]({ layout: 'floating' }))
  expect(second.read()[0]).toEqual({ layout: 'floating', framed: true })
  act(() => second.read()[1]({ framed: false }))
  second.unmount()
  const third = mount()
  expect(third.read()[0]).toEqual({ layout: 'floating', framed: false })
  third.unmount()
})

it.each(['{', 'null', '{"layout":"outside","framed":"true"}'])(
  'ignores invalid stored preferences: %s',
  (saved) => {
    localStorage.setItem('oak-visual-editor:workspace-layout', saved)
    const workspace = mount()
    expect(workspace.read()[0]).toEqual({ layout: 'floating', framed: false })
    workspace.unmount()
  },
)

it('keeps both settings usable when storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const workspace = mount()
  act(() => workspace.read()[1]({ layout: 'sidebar', framed: true }))
  expect(workspace.read()[0]).toEqual({ layout: 'sidebar', framed: true })
  workspace.unmount()
})
