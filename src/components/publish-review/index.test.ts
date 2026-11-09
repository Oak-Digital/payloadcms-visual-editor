import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { PublishReview } from './index.js'

it('shows the new rich text immediately and keeps published content collapsed', () => {
  const html = renderToStaticMarkup(
    createElement(PublishReview, {
      loading: false,
      onEdit: () => {},
      items: [
        {
          key: 'page',
          collection: 'pages',
          pending: true,
          status: 'ready',
          draft: true,
          label: 'Home',
          published: true,
          revision: '1',
          changes: [
            {
              path: 'layout.0.richText',
              label: 'Introduction › Rich text',
              before: 'Old content',
              after: {
                root: {
                  type: 'root',
                  children: [
                    {
                      type: 'paragraph',
                      children: [{ type: 'text', text: 'New content', format: 1 }],
                    },
                  ],
                },
              },
            },
            { path: 'caption', label: 'Caption', before: 'Old caption', after: undefined },
          ],
        },
      ],
    }),
  )
  const container = document.createElement('div')
  container.innerHTML = html
  expect(container.querySelector('b')?.textContent).toBe('New content')
  expect(container.querySelector('b')?.closest('details')).toBeNull()
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.querySelector('details')?.textContent).toContain('Old content')
  expect(container.textContent).toContain('Removed')
  expect(container.textContent).not.toContain('layout.0')
})
