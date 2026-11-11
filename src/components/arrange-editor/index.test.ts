import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, expect, it, vi } from 'vitest'
import { documentKey } from '../../utils/field-target.js'
import { recoveryKey } from '../../utils/recovery.js'
import { ArrangeEditor } from './index.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.mock('../../hooks/use-preview-refresh.js', () => ({ usePreviewRefresh: () => vi.fn() }))
vi.mock('../media-picker/index.js', () => ({ MediaPicker: () => null }))
vi.mock('../rich-text-editor/dialog.js', () => ({ RichTextDialog: () => null }))
vi.mock('../revision-history/index.js', () => ({ RevisionHistory: () => null }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })))

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
        layout: [
          {
            path: 'layout',
            type: 'blocks',
            label: 'Layout',
            children: added
              ? [
                  {
                    path: 'layout.2',
                    type: 'item',
                    label: 'Section',
                    children: [
                      { path: 'layout.2.heading', type: 'text', label: 'Heading' },
                      { path: 'layout.2.image', type: 'upload', label: 'Image' },
                    ],
                  },
                ]
              : [],
          },
        ],
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
    const headingField = document.querySelector<HTMLElement>('[data-draft-block] h2')!
    await act(async () => headingField.click())
    const input = container.querySelector('input')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
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

it('keeps textarea drafts and save actions mounted while hidden and rejects unrelated frame messages', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })))
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
      JSON.stringify({ fields: { title: { type: 'textarea', value: 'Original' } }, orders: {} }),
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
    const input = panel.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      '[aria-label="Title"]',
    )!
    expect(input.value).toBe('Original')
    const reset = () =>
      [...panel.querySelectorAll('button')].find((button) => button.textContent === 'Reset')
    expect(reset()).toBeUndefined()
    expect(input.tagName).toBe('TEXTAREA')
    if (input instanceof HTMLTextAreaElement) expect(input.rows).toBe(3)
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        input,
        'Pending draft',
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelector('h1')?.textContent).toBe('Pending draft')
    expect(reset()?.disabled).toBe(false)
    expect(actions.querySelector('button')?.disabled).toBe(false)
    await message({ type: 'visual-editor:show', view: 'changes' }, 'https://unrelated.example')
    expect(
      panel.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Title"]'),
    ).toBe(input)
    await message({ type: 'visual-editor:show', view: 'changes' }, window.location.origin, null)
    expect(
      panel.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Title"]'),
    ).toBe(input)
    // Browsing and collapsing hide the host, without unmounting the field or action portals.
    await act(async () => {
      panel.hidden = true
      root.render(createElement(ArrangeEditor, { ...props, active: false }))
    })
    expect(
      panel.querySelector<HTMLInputElement | HTMLTextAreaElement>('[aria-label="Title"]'),
    ).toBe(input)
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
    await act(async () => reset()!.click())
    expect(input.value).toBe('Original')
    expect(document.activeElement).toBe(input)
    expect(document.querySelector('h1')?.textContent).toBe('Original')
    expect(reset()).toBeUndefined()
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
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })))
  document.body.innerHTML =
    '<h1 data-payload-path="title">Original</h1><div id="editor"></div><div id="panel"></div><div id="actions" data-feedback-toolbar></div>'
  const root = createRoot(document.getElementById('editor')!)
  const panel = document.getElementById('panel')!
  const actions = document.getElementById('actions')!
  const pending = vi.fn()
  let finish: (response: Response) => void = () => {}
  const reveal = vi.fn()
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
          onReveal: reveal,
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
    reveal.mockClear()
    await act(async () => (actions.querySelector('button:last-child') as HTMLButtonElement).click())
    expect(reveal).toHaveBeenCalledOnce()
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

it.each([
  { conflict: false, restore: false },
  { conflict: true, restore: false },
  { conflict: false, restore: true },
])(
  'reveals stored edits before saving (conflict: $conflict, restore: $restore)',
  async ({ conflict, restore }) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })))
    document.body.innerHTML =
      '<h1 data-payload-path="title">Original</h1><main data-payload-block-list="layout"><section data-payload-block-id="a"></section><section data-payload-block-id="b"></section></main><div id="editor"></div><div id="panel" hidden></div><div id="actions" data-feedback-toolbar></div>'
    const root = createRoot(document.getElementById('editor')!)
    const panel = document.getElementById('panel')!
    const actions = document.getElementById('actions')!
    const owner = { id: 'recovery-page', collection: 'pages', hasDrafts: true, locale: 'en' }
    const snapshot = {
      fields: { title: { type: 'text', value: 'Original' } },
      orders: {
        layout: [
          { id: 'a', label: 'First' },
          { id: 'b', label: 'Second' },
        ],
      },
      revision: 'current',
      recoveryUser: 'editor',
    }
    const key = recoveryKey({
      api: '/api',
      user: 'editor',
      kind: 'page',
      document: documentKey(owner),
      locale: 'en',
    })
    const stored = JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      revision: conflict ? 'older' : 'current',
      value: {
        owner,
        snapshot,
        changes: { title: 'Stored title' },
        orders: {},
        additions: {},
        media: {},
      },
    })
    localStorage.setItem(key, stored)
    const pending = vi.fn()
    const reveal = vi.fn(() => {
      panel.hidden = false
    })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json(snapshot))
    const button = (label: string) =>
      [...document.querySelectorAll('button')].find((b) => b.textContent === label)!
    const saves = () =>
      fetch.mock.calls
        .map(([, init]) => JSON.parse(String(init?.body)))
        .filter((request) => request.action === 'save')
    try {
      await act(async () =>
        root.render(
          createElement(ArrangeEditor, {
            active: true,
            adminRoute: '/admin',
            apiRoute: '/api',
            documentInfo: owner,
            panelContainer: panel,
            actionsContainer: actions,
            historyContainer: actions,
            onClose: vi.fn(),
            onReveal: reveal,
            onPendingChange: pending,
          }),
        ),
      )
      expect(pending.mock.lastCall?.[3]).toBe('Review stored edits before saving.')
      await act(async () => button('Rearrange').click())
      const surface = document.querySelector<HTMLElement>('[data-canvas-rearrange]')!
      expect(surface).toBeTruthy()
      const destination = document.querySelector('[data-payload-block-id="b"]')!
      const hitTest = vi.fn(() => destination)
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hitTest })
      for (const [type, y] of [
        ['pointerdown', 10],
        ['pointermove', 100],
        ['pointerup', 100],
      ] as const) {
        await act(async () =>
          surface.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              button: 0,
              clientX: 10,
              clientY: y,
            }),
          ),
        )
      }
      expect(
        [...document.querySelectorAll('main > section')].map(
          (row) => (row as HTMLElement).style.order,
        ),
      ).toEqual(['1', '0'])
      expect(localStorage.getItem(key)).toBe(stored)
      await act(async () => button('Save draft').click())
      expect(saves()).toHaveLength(0)
      await act(async () =>
        actions.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click(),
      )
      expect(
        [...document.querySelectorAll('main > section')].map(
          (row) => (row as HTMLElement).style.order,
        ),
      ).toEqual(['', ''])
      await act(async () =>
        [...panel.querySelectorAll('button')].find((item) => item.textContent === 'Edit')!.click(),
      )
      // The workspace home view hides the recovery panel but retains the save footer.
      panel.hidden = true
      reveal.mockClear()
      await act(async () => button('Save draft').click())
      expect(reveal).toHaveBeenCalledOnce()
      expect(panel.hidden).toBe(false)
      expect(panel.textContent).toContain('Review stored edits')
      expect(panel.textContent).toContain('Stored title')
      expect(button('Restore edits').disabled).toBe(conflict)
      expect(saves()).toHaveLength(0)
      expect(localStorage.getItem(key)).toBe(stored)

      await act(async () => {
        const title = document.querySelector('h1')!
        title.textContent = 'Current edit'
        title.dispatchEvent(new InputEvent('input', { bubbles: true }))
      })
      expect(button('Restore edits').disabled).toBe(true)
      expect(panel.textContent).toContain(
        conflict
          ? 'Review and discard stored edits before saving. Your current changes are kept.'
          : 'Undo current changes to restore stored edits, or discard stored edits to keep your current changes.',
      )
      panel.hidden = true
      reveal.mockClear()
      await act(async () => button('Save draft').click())
      expect(reveal).toHaveBeenCalledOnce()
      expect(saves()).toHaveLength(0)
      expect(document.querySelector('h1')?.textContent).toBe('Current edit')
      expect(localStorage.getItem(key)).toBe(stored)

      if (restore) {
        await act(async () =>
          actions.querySelector<HTMLButtonElement>('[aria-label="Undo"]')!.click(),
        )
        expect(button('Restore edits').disabled).toBe(false)
        await act(async () => button('Restore edits').click())
      } else {
        await act(async () => button('Discard stored edits').click())
      }
      const savedTitle = restore ? 'Stored title' : 'Current edit'
      expect(document.querySelector('h1')?.textContent).toBe(savedTitle)
      expect(panel.querySelector('[aria-label="Recover unsaved edits"]')).toBeNull()
      expect(pending.mock.lastCall?.[3]).toBe('')
      await act(async () => button('Save draft').click())
      expect(saves()).toHaveLength(1)
      expect(saves()[0].changes).toEqual([{ path: 'title', value: savedTitle }])
      expect(pending.mock.lastCall?.[3]).toBe('Draft saved.')
      expect(localStorage.getItem(key)).toBeNull()
    } finally {
      await act(async () => root.unmount())
      localStorage.removeItem(key)
      document.body.replaceChildren()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  },
)

it('shows compact schema groups and navigates nested items without mixing blocks or losing edits', async () => {
  const { buildFieldLayout } = await import('../../utils/field-layout.js')
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })))
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  document.body.innerHTML =
    '<main data-payload-block-list="layout"><section data-payload-block-id="a"></section><section data-payload-block-id="b"></section></main><div id="editor"></div><div id="panel"></div>'
  for (const section of document.querySelectorAll('section')) section.scrollIntoView = vi.fn()
  const root = createRoot(document.getElementById('editor')!)
  const panel = document.getElementById('panel')!
  const snapshot = {
    revision: 'revision',
    fields: {
      'layout.0.heading': { type: 'text', value: 'Intro' },
      'layout.0.publications': {
        type: 'select',
        hasMany: true,
        value: ['forbes'],
        options: [
          { label: 'Forbes', value: 'forbes' },
          { label: 'DR', value: 'dr' },
        ],
      },
      'layout.1.stages.0.heading': { type: 'text', value: 'Design' },
      'layout.1.stages.0.details.0.label': { type: 'text', value: 'Material' },
      'layout.1.hasAutoplay': { type: 'checkbox', value: true },
    },
    orders: {
      layout: [
        { id: 'a', label: 'DNA introduction' },
        { id: 'b', label: 'DNA process' },
      ],
    },
  }
  const schema: any = [
    {
      name: 'layout',
      type: 'blocks',
      blocks: [
        {
          slug: 'intro',
          fields: [
            {
              type: 'collapsible',
              label: 'Statement',
              fields: [{ name: 'heading', type: 'text' }],
            },
            {
              type: 'collapsible',
              label: 'Press',
              fields: [{ name: 'publications', type: 'select' }],
            },
          ],
        },
        {
          slug: 'process',
          fields: [
            {
              name: 'stages',
              type: 'array',
              fields: [
                { name: 'heading', type: 'text' },
                { name: 'details', type: 'array', fields: [{ name: 'label', type: 'text' }] },
              ],
            },
            { name: 'hasAutoplay', type: 'checkbox' },
          ],
        },
      ],
    },
  ]
  const layout = buildFieldLayout(
    schema,
    {
      layout: [
        { id: 'a', blockType: 'intro' },
        {
          id: 'b',
          blockType: 'process',
          stages: [
            { id: 'stage', heading: 'Design', details: [{ id: 'detail', label: 'Material' }] },
          ],
        },
      ],
    },
    snapshot.fields,
  )
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify({ ...snapshot, layout })))
  const click = async (label: string) => {
    const button = [...panel.querySelectorAll('button')].find(
      (b) => b.getAttribute('aria-label') === label || b.textContent === label,
    )!
    expect(button, label).toBeTruthy()
    await act(async () => button.click())
  }
  const input = (label: string) =>
    panel.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!
  try {
    await act(async () =>
      root.render(
        createElement(ArrangeEditor, {
          active: true,
          adminRoute: '/admin',
          apiRoute: '/api',
          documentInfo: { id: 'page', collection: 'pages', hasDrafts: true },
          panelContainer: panel,
          onClose: vi.fn(),
        }),
      ),
    )
    await click('Edit DNA introduction')
    expect(panel.querySelector('[aria-label="Statement"]')).toBeTruthy()
    expect(panel.querySelector('[aria-label="Press"]')).toBeTruthy()
    expect(input('Heading').value).toBe('Intro')
    expect(panel.textContent).not.toContain('Has Autoplay')
    const select = panel.querySelector<HTMLButtonElement>('[role="combobox"]')!
    expect(select.textContent).toContain('Forbes')
    await act(async () => select.click())
    const option = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((o) =>
      o.textContent?.includes('DR'),
    )!
    await act(async () => option.click())
    expect(select.textContent).toContain('Forbes, DR')
    await act(async () => select.click())
    await click('Back')
    await click('Edit DNA process')
    expect(panel.querySelectorAll('input[type="text"]')).toHaveLength(0)
    await act(async () =>
      panel.querySelector<HTMLButtonElement>('[data-layout-path="layout.1.stages"]')!.click(),
    )
    expect(panel.textContent).toContain('Design')
    await act(async () =>
      panel.querySelector<HTMLButtonElement>('[data-layout-path="layout.1.stages.0"]')!.click(),
    )
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        input('Heading'),
        'New design',
      )
      input('Heading').dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () =>
      panel
        .querySelector<HTMLButtonElement>('[data-layout-path="layout.1.stages.0.details"]')!
        .click(),
    )
    await act(async () =>
      panel
        .querySelector<HTMLButtonElement>('[data-layout-path="layout.1.stages.0.details.0"]')!
        .click(),
    )
    expect(input('Label').value).toBe('Material')
    await click('Back')
    await click('Back')
    expect(input('Heading').value).toBe('New design')
    await click('Back')
    await click('Back')
    await click('Back')
    await click('Edit DNA introduction')
    expect(panel.querySelector('[role="combobox"]')?.textContent).toContain('Forbes, DR')
    expect(
      fetch.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).action === 'read'),
    ).toBe(true)
  } finally {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

it('routes contextual block actions to their list and hides them in chooser and rearrange views', async () => {
  document.body.innerHTML =
    '<main data-payload-block-list="layout"><section data-payload-block-id="a"></section></main><main data-payload-block-list="secondary"><section data-payload-block-id="b"></section></main><div id="root"></div><div id="panel"></div><div id="context"></div>'
  const root = createRoot(document.getElementById('root')!)
  const panel = document.getElementById('panel')!
  const context = document.getElementById('context')!
  document.querySelector('section')!.scrollIntoView = vi.fn()
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false })))
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json({
      revision: 'revision',
      fields: {},
      layout: [
        { path: 'layout', type: 'blocks', label: 'Main content', children: [] },
        { path: 'secondary', type: 'blocks', label: 'Secondary content', children: [] },
      ],
      orders: {
        layout: [{ id: 'a', label: 'First', blockType: 'hero' }],
        secondary: [{ id: 'b', label: 'Second', blockType: 'text' }],
      },
      blockTypes: {
        layout: [{ slug: 'hero', label: 'Hero' }],
        secondary: [{ slug: 'text', label: 'Text' }],
      },
      blockLimits: { layout: { min: 1, max: 1 } },
    }),
  )
  const click = async (parent: HTMLElement, label: string) => {
    const button = [...parent.querySelectorAll('button')].find(
      (button) => button.textContent === label || button.getAttribute('aria-label') === label,
    )!
    expect(button).toBeTruthy()
    expect(button.disabled, panel.textContent || '').toBe(false)
    await act(async () => button.click())
  }
  try {
    await act(async () =>
      root.render(
        createElement(ArrangeEditor, {
          active: true,
          adminRoute: '/admin',
          apiRoute: '/api',
          documentInfo: { id: 'context-page', collection: 'pages', hasDrafts: true },
          panelContainer: panel,
          contextActionsContainer: context,
          onClose: vi.fn(),
        }),
      ),
    )
    expect(panel.textContent).not.toContain('Add block to')
    expect(context.textContent).toContain('Add block to Secondary content')
    expect((context.querySelector('button') as HTMLButtonElement).disabled).toBe(true)
    await click(context, 'Add block to Secondary content')
    expect(context.childElementCount).toBe(0)
    expect(panel.querySelector('[aria-label="Add Text"]')).toBeTruthy()
    expect(panel.querySelector('[aria-label="Add Hero"]')).toBeNull()
    await click(panel, 'Back')
    await click(panel, 'Rearrange')
    expect(context.childElementCount).toBe(0)
    await click(panel, 'Edit')
    await click(panel, 'Edit First')
    expect(context.textContent).toContain('Duplicate block')
    expect(context.textContent).toContain('Remove block')
    expect([...context.querySelectorAll('button')].every((button) => button.disabled)).toBe(true)
    expect(panel.textContent).not.toContain('Duplicate block')
    await click(panel, 'Back')
    expect(context.textContent).toContain('Add block to Secondary content')
  } finally {
    await act(async () => root.unmount())
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  }
})

it('opens canvas rich text in an anchored overlay and retains structured edits after confirming', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.innerHTML =
    '<div data-payload-path="body" data-payload-type="richText">Original</div><div id="editor"></div>'
  const container = document.getElementById('editor')!
  const root = createRoot(container)
  const anchor = document.querySelector<HTMLElement>('[data-payload-path]')!
  const original = { root: { type: 'root', children: [] } }
  const edited = {
    root: {
      type: 'root',
      children: [{ type: 'paragraph', children: [{ type: 'text', format: 1, text: 'Edited' }] }],
    },
  }
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  })
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        revision: 'revision',
        fields: {
          body: { type: 'richText', value: original, schemaPath: 'collection.pages.body' },
        },
        orders: {},
      }),
    ),
  )
  try {
    await act(async () =>
      root.render(
        createElement(ArrangeEditor, {
          active: true,
          adminRoute: '/admin',
          apiRoute: '/api',
          documentInfo: { id: 'overlay-test', collection: 'pages', hasDrafts: true },
          onClose: vi.fn(),
        }),
      ),
    )
    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent === 'Edit content›')!
        .click(),
    )
    await act(async () => {
      anchor.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    const warmedFrame = document.querySelector<HTMLIFrameElement>('dialog iframe')!
    expect(warmedFrame).toBeTruthy()
    expect(document.querySelector('dialog')!.open).toBe(false)
    await act(async () => anchor.click())
    const dialog = document.querySelector<HTMLDialogElement>('dialog[aria-label="Edit rich text"]')!
    expect(dialog.open).toBe(true)
    expect(container.contains(dialog)).toBe(false)
    const frame = dialog.querySelector('iframe')!
    expect(frame).toBe(warmedFrame)
    const send = async (type: string, value?: unknown) =>
      act(async () =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type, value },
            source: frame.contentWindow,
            origin: window.location.origin,
          }),
        ),
      )
    await send('payload-visual-editor:ready')
    await send('payload-visual-editor:changed', edited)
    const drawer = async (expanded: boolean) =>
      act(async () =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'payload-visual-editor:drawer', expanded },
            source: frame.contentWindow,
            origin: window.location.origin,
          }),
        ),
      )
    await drawer(true)
    expect(dialog.style.height).toBe('640px')
    expect(dialog.querySelector('button')!.disabled).toBe(true)
    await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })))
    expect(dialog.open).toBe(true)
    await drawer(false)
    expect(dialog.style.height).toBe('340px')
    await act(async () => dialog.querySelector('button')!.click())
    expect(document.querySelector('dialog')!.open).toBe(false)
    expect(document.activeElement).toBe(anchor)
    await act(async () => anchor.click())
    const reopened = document.querySelector<HTMLIFrameElement>('dialog iframe')!
    expect(reopened).toBe(frame)
    const post = vi.spyOn(reopened.contentWindow!, 'postMessage')
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'payload-visual-editor:ready' },
          source: reopened.contentWindow,
          origin: window.location.origin,
        }),
      ),
    )
    expect(post).toHaveBeenLastCalledWith(
      { type: 'payload-visual-editor:initial', value: edited },
      window.location.origin,
    )
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    await act(async () => window.dispatchEvent(new Event('resize')))
    expect(document.querySelector('dialog')!.style.width).toBe('366px')
    await act(async () =>
      document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })),
    )
    expect(document.querySelector('dialog')!.open).toBe(false)
    expect(
      fetch.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).action === 'read'),
    ).toBe(true)
  } finally {
    await act(async () => root.unmount())
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  }
})
