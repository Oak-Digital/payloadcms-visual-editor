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
    layout: [{ path: 'flag', label: 'Enabled', type: 'checkbox' }],
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

it.each([false, true])('recovers shared edits after remount; conflict=%s', async (conflict) => {
  vi.useFakeTimers()
  const records = new Map<string, string>()
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value)
    },
    removeItem: (key: string) => {
      records.delete(key)
    },
  }
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
  const container = document.createElement('div')
  document.body.append(container)
  let root = createRoot(container)
  let revision = 'one'
  let fail = true
  const snapshot = (flag: boolean) => ({
    revision,
    recoveryUser: 'users:test',
    drafts: true,
    status: 'published',
    document: { flag },
    layout: [{ path: 'flag', label: 'Enabled', type: 'checkbox' }],
    nodes: [{ path: 'flag', label: 'Enabled', type: 'checkbox', value: flag }],
  })
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.action === 'save' && fail)
      return Response.json({ error: 'Save failed' }, { status: 500 })
    return Response.json(snapshot(body.action !== 'read'))
  })
  const props = {
    target: { slug: 'settings', global: true, label: 'Settings' },
    apiRoute: '/api',
    locale: 'en',
    onClose: vi.fn(),
    onCollapse: vi.fn(),
    onPreview: vi.fn(),
    onSaved: vi.fn(),
    onStateChange: vi.fn(),
    onOpen: vi.fn(),
    enabledSources: [],
  }
  const mount = () => act(async () => root.render(createElement(SharedContentEditor, props)))
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((b) => b.textContent === label)!
  try {
    await mount()
    await act(async () => container.querySelector<HTMLInputElement>('input')!.click())
    await act(async () => vi.advanceTimersByTimeAsync(300))
    expect(records.size).toBe(1)
    await act(async () => root.unmount())
    if (conflict) revision = 'newer'
    root = createRoot(container)
    await mount()
    expect(button('Restore edits')).toBeTruthy()
    expect(container.querySelector<HTMLInputElement>('input')!.checked).toBe(false)
    expect(button('Restore edits').disabled).toBe(conflict)
    if (conflict) {
      expect(container.textContent).toContain('newer changes')
      expect(records.size).toBe(1)
      await act(async () => button('Discard stored edits').click())
      expect(records.size).toBe(0)
    } else {
      await act(async () => button('Restore edits').click())
      await act(async () => vi.advanceTimersByTimeAsync(300))
      expect(container.querySelector<HTMLInputElement>('input')!.checked).toBe(true)
      await act(async () => button('Save draft').click())
      expect(records.size).toBe(1)
      expect(container.textContent).toContain('Save failed')
      fail = false
      await act(async () => button('Save draft').click())
      expect(records.size).toBe(0)
      expect(props.onSaved).toHaveBeenCalledOnce()
    }
  } finally {
    await act(async () => root.unmount())
    container.remove()
    fetcher.mockRestore()
    if (descriptor) Object.defineProperty(window, 'localStorage', descriptor)
    vi.useRealTimers()
  }
})

it('reviews earlier saved shared drafts and retries only documents that did not publish', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const published = new Set<string>()
  const attempts: string[] = []
  let fail = true
  const snapshot = (id: string) => ({
    revision: id,
    drafts: true,
    status: published.has(id) ? 'published' : 'draft',
    nodes: [],
    document: { title: id },
  })
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.action === 'review')
      return Response.json({
        revision: body.id,
        published: true,
        changes: published.has(body.id) ? [] : [{ path: 'title', before: 'Old', after: body.id }],
      })
    if (body.action === 'publish') {
      attempts.push(body.id)
      if (body.id === 'second' && fail)
        return Response.json({ error: 'Second failed' }, { status: 500 })
      published.add(body.id)
    }
    return Response.json(snapshot(body.id))
  })
  const props = {
    apiRoute: '/api',
    locale: 'en',
    onClose: vi.fn(),
    onCollapse: vi.fn(),
    onPreview: vi.fn(),
    onSaved: vi.fn(),
    onStateChange: vi.fn(),
    onOpen: vi.fn(),
    enabledSources: [],
  }
  const render = (id: string) =>
    act(async () =>
      root.render(
        createElement(SharedContentEditor, {
          ...props,
          target: { slug: 'navigation', id, label: id },
        }),
      ),
    )
  const button = (label: string) =>
    [...container.querySelectorAll('button')].find((button) => button.textContent === label)!
  try {
    await render('first')
    await render('second')
    await act(async () => button('Publish all').click())
    expect(attempts).toEqual([])
    expect(container.textContent).toContain('Review changes across 2 documents.')
    await act(async () => button('Publish shared changes').click())
    expect(container.querySelectorAll('[data-publish-status="published"]')).toHaveLength(1)
    expect(container.querySelectorAll('[data-publish-status="failed"]')).toHaveLength(1)
    expect(button('Publish shared changes').disabled).toBe(true)
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.textContent?.split('Second failed')).toHaveLength(2)
    expect(button('Discard edits and reload')).toBeUndefined()
    await act(async () => button('Edit content').click())
    expect(props.onOpen).toHaveBeenCalledWith({ slug: 'navigation', id: 'second', label: 'second' })
    expect(container.querySelector('[aria-label="Publish review"]')).toBeNull()
    await act(async () => button('Publish all').click())
    fail = false
    await act(async () => button('Refresh review').click())
    expect(container.textContent).toContain('Review changes before publishing.')
    await act(async () => button('Publish shared changes').click())
    expect(attempts).toEqual(['first', 'second', 'second'])
    expect(props.onSaved).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    fetcher.mockRestore()
  }
})

it('closes a multi-select on Escape before navigating out of shared content', async () => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const onClose = vi.fn()
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      Response.json({
        revision: 'one',
        drafts: true,
        document: { choices: ['one'] },
        layout: [{ path: 'choices', label: 'Choices', type: 'select' }],
        nodes: [
          {
            path: 'choices',
            label: 'Choices',
            type: 'select',
            hasMany: true,
            value: ['one'],
            options: [{ label: 'One', value: 'one' }],
          },
        ],
      }),
    ),
  )
  try {
    await act(() =>
      Promise.resolve(
        root.render(
          createElement(SharedContentEditor, {
            target: { slug: 'settings', global: true, label: 'Settings' },
            apiRoute: '/api',
            onClose,
            onCollapse: vi.fn(),
            onPreview: vi.fn(),
            onSaved: vi.fn(),
            onStateChange: vi.fn(),
            onOpen: vi.fn(),
            enabledSources: [],
          }),
        ),
      ),
    )
    const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!
    await act(() => Promise.resolve(trigger.click()))
    await act(() =>
      Promise.resolve(
        document.activeElement!.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        ),
      ),
    )
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(trigger)
    await act(() =>
      Promise.resolve(
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
      ),
    )
    expect(onClose).toHaveBeenCalledOnce()
  } finally {
    await act(() => Promise.resolve(root.unmount()))
    container.remove()
    fetcher.mockRestore()
  }
})
