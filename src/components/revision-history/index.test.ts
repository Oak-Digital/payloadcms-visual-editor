import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

import { RevisionHistory } from './index.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
const owner = { id: 'page-1', collection: 'pages', hasDrafts: true, locale: 'da' }
const container = document.createElement('div')
let root: ReturnType<typeof createRoot>
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

afterEach(async () => {
  if (root) {
    await act(async () => {
      root.unmount()
      await Promise.resolve()
    })
  }
  vi.restoreAllMocks()
})

it('requires a successful preview and clean pending state before restoring a draft', async () => {
  root = createRoot(container)
  const docs = [{ id: 'v1', updatedAt: '2026-01-01T00:00:00Z', version: { title: 'Old' } }]
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ docs })))
  const onPreview = vi.fn(async () => 'current-revision')
  const onReturn = vi.fn()
  const onRestore = vi.fn(async () => {})
  const props = {
    apiRoute: '/api',
    owner,
    refresh: 0,
    onPreview,
    onReturn,
    onRestore,
    canRestore: false,
  }
  await act(async () => {
    root.render(createElement(RevisionHistory, props))
    await Promise.resolve()
  })
  await act(async () => {
    ;[...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'Preview revision')
      ?.click()
    await Promise.resolve()
  })
  expect(onPreview).toHaveBeenCalledWith(owner, 'v1')
  const restore = [...container.querySelectorAll('button')].find(
    (button) => button.textContent === 'Restore as draft',
  )!
  expect(restore.disabled).toBe(true)
  expect(onRestore).not.toHaveBeenCalled()
  await act(async () => {
    root.render(createElement(RevisionHistory, { ...props, canRestore: true }))
    await Promise.resolve()
  })
  await act(async () => {
    restore.click()
    await Promise.resolve()
  })
  expect(onRestore).toHaveBeenCalledWith(owner, 'v1', 'current-revision')
})
