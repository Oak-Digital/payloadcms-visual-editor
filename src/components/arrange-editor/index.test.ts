import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ArrangeEditor } from './index.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.mock('../../hooks/use-preview-refresh.js', () => ({ usePreviewRefresh: () => vi.fn() }))
vi.mock('../media-picker/index.js', () => ({ MediaPicker: () => null }))
vi.mock('../rich-text-editor/dialog.js', () => ({ RichTextDialog: () => null }))
vi.mock('../revision-history/index.js', () => ({ RevisionHistory: () => null }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

it('separates rearranging from editing and locates the selected block after moving it', async () => {
  document.body.innerHTML =
    '<main data-payload-block-list="layout"><section data-payload-block-id="a"></section><section data-payload-block-id="b"></section></main><div id="editor"></div>'
  const container = document.getElementById('editor')!
  const root = createRoot(container)
  const scroll = vi.fn()
  const block = document.querySelector('[data-payload-block-id="b"]')!
  block.scrollIntoView = scroll
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    const added = body.orders?.[0]?.additions?.[0]
    return new Response(
      JSON.stringify({
        revision: 'revision',
        fields: added
          ? {
              'layout.2.heading': { type: 'text', value: 'Section' },
              'layout.2.image': { type: 'upload', value: null },
            }
          : {},
        orders: {
          layout: [
            { id: 'a', label: 'First' },
            { id: 'b', label: 'Second' },
          ],
        },
        blockTypes: { layout: [{ slug: 'section', label: 'Section' }] },
        blockLimits: { layout: { min: 0 } },
      }),
    )
  })
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === label || button.textContent === label,
    )!
    expect(button).toBeTruthy()
    await act(async () => button.click())
  }
  try {
    await act(async () =>
      root.render(
        createElement(ArrangeEditor, {
          active: true,
          adminRoute: '/admin',
          apiRoute: '/api',
          documentInfo: { id: 'page', collection: 'pages', hasDrafts: true },
          onClose: vi.fn(),
        }),
      ),
    )
    expect(container.querySelector('[aria-label="Editor menu"]')).toBeTruthy()
    expect(container.querySelector('ol')).toBeNull()
    await click('Edit content›')
    expect(container.querySelector('[aria-label="Edit Second"]')).toBeTruthy()
    expect(container.querySelector('[aria-label="Move Second up"]')).toBeNull()
    await click('Back')
    await click('Rearrange content›')
    expect(container.querySelector('[aria-label="Edit Second"]')).toBeNull()
    await click('Move Second up')
    expect(scroll).not.toHaveBeenCalled()
    await click('Back')
    await click('Edit content›')
    expect(container.querySelector('ol button')?.textContent).toContain('Second')
    await click('Edit Second')
    expect(scroll).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' })
    await click('Back')
    expect(container.querySelector('ol button')?.textContent).toContain('Second')
    await click('Edit Second')
    await click('Remove block')
    expect(container.querySelectorAll('ol li')).toHaveLength(1)
    expect(
      (document.querySelector('[data-payload-block-id="b"]') as HTMLElement).style.display,
    ).toBe('none')
    await click('Add block')
    expect(container.querySelector('[aria-label="Add block"]')).toBeTruthy()
    await click('Add Section')
    expect(container.textContent).not.toContain('Save draft to edit this block.')
    expect(document.querySelector('[data-draft-block] h2')?.textContent).toBe('Section')
    expect(document.querySelector('[data-draft-block] img')?.getAttribute('src')).toContain(
      'data:image/svg+xml',
    )
    const headingField = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.startsWith('Heading'),
    )!
    await act(async () => headingField.click())
    const input = container.querySelector('textarea')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        'Before saving',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('[data-draft-block] h2')?.textContent).toBe('Before saving')
    expect(
      fetch.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).action === 'read'),
    ).toBe(true)
    await click('Back')
    await click('Remove block')
    expect(container.querySelectorAll('ol li')).toHaveLength(1)
    expect(document.querySelector('[data-draft-block]')).toBeNull()
  } finally {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

it('keeps workspace drafts and save actions mounted while hidden and rejects unrelated frame messages', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.innerHTML =
    '<main><h1 data-payload-path="title">Original</h1></main><div id="editor"></div><div id="panel"></div><div id="heading"></div><div id="actions"></div><div id="history" data-feedback-toolbar></div>'
  const root = createRoot(document.getElementById('editor')!)
  const panel = document.getElementById('panel')!
  const heading = document.getElementById('heading')!
  const actions = document.getElementById('actions')!
  const reveal = vi.fn()
  const home = vi.fn()
  const pending = vi.fn()
  const props = {
    active: true,
    adminRoute: '/admin',
    apiRoute: '/api',
    documentInfo: { id: 'page', collection: 'pages', hasDrafts: true },
    panelContainer: panel,
    headerContainer: heading,
    actionsContainer: actions,
    historyContainer: document.getElementById('history')!,
    onClose: vi.fn(),
    onHome: home,
    onReveal: reveal,
    onPendingChange: pending,
  }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ fields: { title: { type: 'text', value: 'Original' } }, orders: {} }),
    ),
  )
  const message = async (
    data: Record<string, unknown>,
    origin = window.location.origin,
    source: MessageEventSource | null = window.parent,
  ) => {
    await act(async () =>
      window.dispatchEvent(new MessageEvent('message', { data, origin, source })),
    )
  }
  try {
    await act(async () => root.render(createElement(ArrangeEditor, props)))
    await act(async () => (document.querySelector('h1') as HTMLElement).click())
    expect(reveal).toHaveBeenCalled()
    const input = panel.querySelector('textarea')!
    expect(input.value).toBe('Original')
    const restoreText = [...panel.querySelectorAll('button')].find(
      (button) => button.textContent === 'Restore text',
    )!
    expect(restoreText.disabled).toBe(true)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        'Pending draft',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('h1')?.textContent).toBe('Pending draft')
    expect(restoreText.disabled).toBe(false)
    expect(actions.querySelector('button')?.disabled).toBe(false)
    await message({ type: 'visual-editor:show', view: 'changes' }, 'https://unrelated.example')
    expect(panel.querySelector('textarea')).toBe(input)
    await message({ type: 'visual-editor:show', view: 'changes' }, window.location.origin, null)
    expect(panel.querySelector('textarea')).toBe(input)
    // Browsing and collapsing hide the host, without unmounting the field or action portals.
    await act(async () => {
      panel.hidden = true
      root.render(createElement(ArrangeEditor, { ...props, active: false }))
    })
    expect(panel.querySelector('textarea')).toBe(input)
    expect(input.value).toBe('Pending draft')
    expect(actions.querySelector('button')?.disabled).toBe(false)
    await act(async () => {
      panel.hidden = false
      root.render(createElement(ArrangeEditor, props))
    })
    expect(input.value).toBe('Pending draft')
    await act(async () =>
      (document.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(),
    )
    expect(input.value).toBe('Original')
    expect(document.querySelector('h1')?.textContent).toBe('Original')
    expect(actions.querySelector('button')?.disabled).toBe(true)
    await act(async () => root.render(createElement(ArrangeEditor, { ...props, active: false })))
    await act(async () => root.render(createElement(ArrangeEditor, props)))
    await act(async () =>
      (document.querySelector('[aria-label="Redo"]') as HTMLButtonElement).click(),
    )
    expect(input.value).toBe('Pending draft')
    expect(actions.querySelector('button')?.disabled).toBe(false)
    await act(async () => {
      const canvas = document.querySelector('h1')!
      canvas.focus()
      canvas.textContent = 'Inline draft'
      canvas.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    expect(input.value).toBe('Inline draft')
    expect(document.activeElement).toBe(document.querySelector('h1'))
    await act(async () =>
      (document.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(),
    )
    expect(input.value).toBe('Pending draft')
    expect(document.querySelector('h1')?.textContent).toBe('Pending draft')
    await act(async () =>
      (document.querySelector('[aria-label="Redo"]') as HTMLButtonElement).click(),
    )
    expect(input.value).toBe('Inline draft')
    await act(async () => restoreText.click())
    expect(input.value).toBe('Original')
    expect(document.querySelector('h1')?.textContent).toBe('Original')
    expect(restoreText.disabled).toBe(true)
    expect(actions.querySelector('button')?.disabled).toBe(true)
    await act(async () =>
      (document.querySelector('[aria-label="Undo"]') as HTMLButtonElement).click(),
    )
    expect(input.value).toBe('Inline draft')
    await message({ type: 'visual-editor:show', view: 'changes' })
    expect(panel.querySelector('details')?.open).toBe(true)
    expect(panel.textContent).toContain('Inline draft')
    await message({ type: 'visual-editor:back' })
    expect(home).toHaveBeenCalled()
    expect(pending).toHaveBeenLastCalledWith(true, false, 1, '', 0)
  } finally {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  }
})

it('reports distinct save/publish states to the footer without duplicating them in the field panel', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.innerHTML =
    '<h1 data-payload-path="title">Original</h1><div id="editor"></div><div id="panel"></div><div id="actions" data-feedback-toolbar></div>'
  const root = createRoot(document.getElementById('editor')!)
  const panel = document.getElementById('panel')!
  const actions = document.getElementById('actions')!
  const pending = vi.fn()
  let finish: (response: Response) => void = () => {}
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.action === 'review')
      return Response.json({
        label: 'Page',
        revision: 'one',
        published: true,
        draft: true,
        changes: [{ path: 'title', before: 'Original', after: 'Saved draft' }],
      })
    if (body.action !== 'read')
      return new Promise<Response>((resolve) => {
        finish = resolve
      })
    return new Response(
      JSON.stringify({ fields: { title: { type: 'text', value: 'Original' } }, orders: {} }),
    )
  })
  try {
    await act(async () =>
      root.render(
        createElement(ArrangeEditor, {
          active: true,
          adminRoute: '/admin',
          apiRoute: '/api',
          documentInfo: { id: 'page', collection: 'pages', hasDrafts: true },
          panelContainer: panel,
          actionsContainer: actions,
          onClose: vi.fn(),
          onPendingChange: pending,
        }),
      ),
    )
    await act(async () => {
      const title = document.querySelector('h1')!
      title.textContent = 'Staged inline'
      title.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await act(async () => (actions.querySelector('button') as HTMLButtonElement).click())
    expect(pending.mock.lastCall?.[3]).toBe('Saving draft…')
    await act(async () => finish(new Response('{}')))
    expect(pending.mock.lastCall?.[3]).toBe('Draft saved.')
    expect(panel.textContent).not.toContain('Draft saved.')
    await act(async () => (actions.querySelector('button:last-child') as HTMLButtonElement).click())
    expect(panel.textContent).toContain('Compare with published')
    expect(actions.textContent).toContain('Publish now')
    await act(async () => (actions.querySelector('button:last-child') as HTMLButtonElement).click())
    expect(pending.mock.lastCall?.[3]).toBe('Publishing…')
    await act(async () => finish(new Response('{}')))
    expect(pending.mock.lastCall?.[3]).toBe('All changes published.')
    expect(panel.textContent).not.toContain('All changes published.')
    await act(async () =>
      [...panel.querySelectorAll('button')]
        .find((button) => button.textContent === 'Refresh review')!
        .click(),
    )
    await act(async () => (actions.querySelector('button:last-child') as HTMLButtonElement).click())
    await act(async () =>
      finish(new Response(JSON.stringify({ error: 'Rejected for verification' }), { status: 500 })),
    )
    expect(pending.mock.lastCall?.[3]).toBe('Publish failed · Changes kept')
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain(
      'Rejected for verification',
    )
    expect(panel.querySelectorAll('[role="alert"]')).toHaveLength(1)
    await act(async () =>
      [...panel.querySelectorAll('button')]
        .find((button) => button.textContent === 'Edit content')!
        .click(),
    )
    await act(() => {
      const title = document.querySelector('h1')!
      title.textContent = 'Still pending'
      title.dispatchEvent(new InputEvent('input', { bubbles: true }))
    })
    await act(async () => (actions.querySelector('button:last-child') as HTMLButtonElement).click())
    await act(async () => (actions.querySelector('button:last-child') as HTMLButtonElement).click())
    await act(async () =>
      finish(
        Response.json(
          {
            error: 'The following fields are invalid: Content > Title',
            fieldErrors: [{ path: 'title', label: 'Title', message: 'Enter a title.' }],
          },
          { status: 400 },
        ),
      ),
    )
    expect(panel.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(panel.textContent).toContain('Title: Enter a title.')
    expect(panel.textContent).not.toContain('The following fields are invalid')
    expect(panel.textContent).not.toContain('Try saving again')
    await act(async () =>
      [...panel.querySelectorAll('button')]
        .find((button) => button.textContent === 'Edit content')!
        .click(),
    )
    expect(panel.querySelector('[aria-label="Publish review"]')).toBeNull()
    expect(actions.textContent).toContain('Publish all')
    expect(document.querySelector('h1')?.textContent).toBe('Still pending')
    expect(pending.mock.lastCall?.[0]).toBe(true)
  } finally {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  }
})
