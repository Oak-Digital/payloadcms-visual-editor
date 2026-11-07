import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

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

async function render(refresh = 0) {
  if (!root) {
    root = createRoot(container)
  }
  await act(async () => {
    root.render(createElement(RevisionHistory, { apiRoute: '/api', owner, refresh }))
    await Promise.resolve()
  })
}

describe('revision history', () => {
  it('requests only the current document and locale, and refreshes after saving', async () => {
    root = createRoot(container)
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          docs: [
            {
              id: 'v2',
              updatedAt: '2026-11-05T10:00:00Z',
              version: { _status: 'draft', title: 'New' },
            },
            {
              id: 'v1',
              updatedAt: '2026-11-04T10:00:00Z',
              version: { _status: 'published', title: 'Old' },
            },
          ],
        }),
      ),
    )
    await render()
    const url = new URL(fetcher.mock.calls[0][0] as string, 'http://localhost')
    expect(url.searchParams.get('where[parent][equals]')).toBe('page-1')
    expect(url.searchParams.get('locale')).toBe('da')
    expect(container.textContent).toContain('Current draft')
    expect(container.textContent).toContain('New')
    expect(container.textContent).toContain('Old')
    fetcher.mockResolvedValue(new Response(JSON.stringify({ docs: [] })))
    await render(1)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('No saved revisions yet.')
  })
  it('shows access failures and allows retry', async () => {
    root = createRoot(container)
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 403 }))
    await render()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Check your access')
    fetcher.mockResolvedValue(new Response(JSON.stringify({ docs: [] })))
    await act(async () => {
      container.querySelector('button')?.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('No saved revisions yet.')
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })
})

it('requires a successful preview and clean pending state before restoring a draft', async () => {
  root = createRoot(container)
  const docs = [{ id: 'v1', updatedAt: '2026-01-01T00:00:00Z', version: { title: 'Old' } }]
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ docs })))
  const onPreview = vi.fn(async () => 'current-revision')
  const onReturn = vi.fn()
  const onRestore = vi.fn(async () => {})
  const props = { apiRoute: '/api', owner, refresh: 0, onPreview, onReturn, onRestore, canRestore: false }
  await act(async () => { root.render(createElement(RevisionHistory, props)); await Promise.resolve() })
  await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Preview revision')?.click(); await Promise.resolve() })
  expect(onPreview).toHaveBeenCalledWith(owner, 'v1')
  const restore = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Restore as draft')!
  expect(restore.disabled).toBe(true)
  expect(onRestore).not.toHaveBeenCalled()
  await act(async () => { root.render(createElement(RevisionHistory, { ...props, canRestore: true })); await Promise.resolve() })
  await act(async () => { restore.click(); await Promise.resolve() })
  expect(onRestore).toHaveBeenCalledWith(owner, 'v1', 'current-revision')
})
