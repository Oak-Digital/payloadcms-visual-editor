import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import { PublishReview, type PublishReviewItem } from './index.js'

it('groups validation fields by block without repeating the technical summary', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const root = createRoot(container)
  const onEdit = vi.fn()
  const item: PublishReviewItem = {
    changes: [],
    collection: 'pages',
    draft: true,
    error: 'Felterne er ugyldige: Content > Layout > Blok 1 (DNA introduction) > Heading',
    fieldErrors: [
      {
        label: 'Content > Layout > Blok 1 (DNA introduction) > Heading',
        message: 'Enter a heading.',
        path: 'layout.0.heading',
      },
      {
        label: 'Content > Layout > Blok 2 (Closing call to action) > Links',
        message: 'Add at least one link.',
        path: 'layout.1.links',
      },
      {
        label: 'Content > Layout > Blok 1 (DNA introduction) > Body',
        message: 'Enter some text.',
        path: 'layout.0.body',
      },
    ],
    key: 'page',
    label: 'About us',
    locale: 'en',
    pending: true,
    published: false,
    revision: 'one',
    status: 'failed',
  }
  try {
    act(() => root.render(createElement(PublishReview, { items: [item], loading: false, onEdit })))
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1)
    expect(container.textContent).not.toContain('Felterne er ugyldige')
    expect(container.textContent).not.toContain('Content > Layout')
    expect(container.textContent?.split('Blok 1 (DNA introduction)')).toHaveLength(2)
    expect(container.querySelectorAll('[role="alert"] li')).toHaveLength(3)
    expect(container.textContent).toContain('Heading: Enter a heading.')
    expect(container.textContent).toContain('Links: Add at least one link.')
    act(() => container.querySelector('button')!.click())
    expect(onEdit).toHaveBeenCalledWith(item)
  } finally {
    act(() => root.unmount())
    vi.unstubAllGlobals()
  }
})
