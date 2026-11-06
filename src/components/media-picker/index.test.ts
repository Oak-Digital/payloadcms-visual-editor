import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { type MediaChoice, MediaPicker } from './index.js'

vi.mock('./styles.module.scss', () => ({ default: {} }))
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)

it('opens image confirmation one view deeper and returns to the library on cancel', async () => {
  document.body.innerHTML = '<div id="picker"></div>'
  const root = createRoot(document.getElementById('picker')!)
  const onSelect = vi.fn()
  const media = { id: 'image-1', url: '/image.jpg', filename: 'image.jpg' }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        docs: [media],
        page: 1,
        totalPages: 1,
        collection: 'media',
        canUpload: true,
      }),
    ),
  )

  function Picker() {
    const [selected, setSelected] = useState<MediaChoice>()
    return createElement(MediaPicker, {
      embedded: true,
      adminRoute: '/admin',
      apiRoute: '/api',
      documentInfo: { id: 'page', collection: 'pages', hasDrafts: true },
      path: 'image',
      onClose: vi.fn(),
      onSelect,
      selected,
      onSelectionChange: setSelected,
    })
  }

  const button = (name: string) =>
    [...document.querySelectorAll('button')].find((item) => item.textContent === name)!

  try {
    await act(async () => root.render(createElement(Picker)))
    await act(async () => new Promise((resolve) => setTimeout(resolve, 250)))
    expect(
      button('Upload a new image').compareDocumentPosition(document.querySelector('input')!),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await act(async () => button('image.jpg').click())
    expect(document.querySelector('input[type="search"]')).toBeNull()
    expect(document.querySelector('[aria-label="Image preview"]')).toBeTruthy()
    expect(onSelect).not.toHaveBeenCalled()

    await act(async () => button('Cancel').click())
    expect(document.querySelector('input[type="search"]')).toBeTruthy()
    await act(async () => button('image.jpg').click())
    await act(async () => button('Use image').click())
    expect(onSelect).toHaveBeenCalledWith(media)
  } finally {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  }
})
