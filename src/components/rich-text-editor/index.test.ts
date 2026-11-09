import type { DefaultTypedEditorState } from '@payloadcms/richtext-lexical'
import { createHeadlessEditor } from '@payloadcms/richtext-lexical/lexical/headless'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import { RichTextEditorView } from './index.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.mock('@payloadcms/ui', () => ({ useConfig: () => ({ config: { routes: { api: '/api' } } }) }))
const lexical = vi.hoisted(() => ({ render: vi.fn() }))
vi.mock('@payloadcms/richtext-lexical/client', () => ({
  RenderLexical: (props: unknown) => lexical.render(props),
}))

const empty: DefaultTypedEditorState = {
  root: { type: 'root', version: 1, format: '', indent: 0, direction: null, children: [] },
}
const populated: DefaultTypedEditorState = {
  root: {
    ...empty.root,
    children: [
      {
        type: 'paragraph',
        version: 1,
        format: '',
        indent: 0,
        direction: null,
        children: [
          {
            type: 'text',
            version: 1,
            text: 'Keep bold',
            format: 1,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
        textFormat: 1,
        textStyle: '',
      },
    ],
  },
}

it('opens empty rich text without changing content and preserves subsequent edits', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const originalURL = window.location.href
  const params = new URLSearchParams({
    collection: 'pages',
    id: 'page',
    path: 'layout.0.body',
    locale: 'en',
  })
  params.set('mode', 'stage')
  params.set('embedded', 'true')
  params.set('schemaPath', 'collection.pages.layout.intro.body')
  window.history.replaceState(null, '', `/?${params}`)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    Response.json({
      revision: 'revision',
      schemaPath: 'collection.pages.layout.intro.body',
      value: empty,
    }),
  )
  const post = vi.spyOn(window.parent, 'postMessage')
  const editor = createHeadlessEditor({
    namespace: 'empty-rich-text-regression',
    onError: (error) => {
      throw error
    },
  })
  lexical.render.mockImplementation(({ initialValue, value }) => {
    // Exercise the real Lexical constraint instead of accepting arbitrary JSON in the stub.
    editor.setEditorState(editor.parseEditorState(JSON.stringify(initialValue)))
    editor.setEditorState(editor.parseEditorState(JSON.stringify(value)))
    return createElement('div', { role: 'textbox' }, 'Rich-text editor')
  })
  const initial = async (value: DefaultTypedEditorState, origin = window.location.origin) => {
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent('message', {
          source: window.parent,
          origin,
          data: { type: 'payload-visual-editor:initial', value },
        }),
      ),
    )
  }
  const changes = () =>
    post.mock.calls.filter(([data]) => data.type === 'payload-visual-editor:changed')
  try {
    await act(async () => root.render(createElement(RichTextEditorView)))
    expect(container.querySelector('[role="textbox"]')).toBeNull()
    await initial(empty)
    expect(container.querySelector('[role="textbox"]')).not.toBeNull()
    const props = lexical.render.mock.lastCall![0]
    expect(props.value.root.children).toHaveLength(1)
    expect(props.value.root.children[0]).toMatchObject({ type: 'paragraph', children: [] })
    expect(empty.root.children).toEqual([])
    expect(changes()).toHaveLength(0)
    expect(
      fetch.mock.calls.every(([, init]) => JSON.parse(String(init?.body)).action === 'read'),
    ).toBe(true)

    await act(async () => props.setValue(populated))
    expect(changes()).toHaveLength(1)
    expect(lexical.render.mock.lastCall![0].value).toBe(populated)
    expect(changes()[0][0].value).toBe(populated)
    await initial(empty, 'https://unrelated.example')
    expect(lexical.render.mock.lastCall![0].value).toBe(populated)
    // Undo to an empty value must initialize safely without echoing a change.
    await initial(empty)
    expect(lexical.render.mock.lastCall![0].value.root.children[0].type).toBe('paragraph')
    await initial(populated)
    expect(lexical.render.mock.lastCall![0].initialValue).toBe(populated)
    expect(changes()).toHaveLength(1)
  } finally {
    await act(async () => root.unmount())
    container.remove()
    window.history.replaceState(null, '', originalURL)
    lexical.render.mockReset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})
