import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { PublishReview } from './index.js'

it('keeps rich text and published comparisons inside collapsed change rows', () => {
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
  expect(container.querySelector('b')?.closest('details')?.open).toBe(false)
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.querySelector('details')?.textContent).toContain('Old content')
  expect(container.textContent).toContain('Removed')
  expect(container.textContent).not.toContain('layout.0')
})

it('groups fields by section identity even when sections share the same name', () => {
  const html = renderToStaticMarkup(
    createElement(PublishReview, {
      loading: false,
      onEdit: () => {},
      items: [
        {
          key: 'page',
          collection: 'pages',
          pending: false,
          status: 'ready',
          draft: true,
          label: 'Home',
          published: true,
          revision: '1',
          changes: [
            {
              path: 'layout.0.heading',
              label: 'Sections › Hero › Heading',
              before: 'Old',
              after: 'New',
            },
            {
              path: 'layout.0.description',
              label: 'Sections › Hero › Description',
              before: 'Old',
              after: 'New',
            },
            {
              path: 'layout.1.heading',
              label: 'Sections › Hero › Heading',
              before: 'Old',
              after: 'Other',
            },
          ],
        },
      ],
    }),
  )
  const container = document.createElement('div')
  container.innerHTML = html
  const rows = container.querySelectorAll('details')
  expect(rows).toHaveLength(2)
  expect(rows[0].querySelector('summary')?.textContent).toContain('Heading, Description')
  expect(rows[1].querySelector('summary')?.textContent).not.toContain('Description')
  expect([...rows].every((row) => !row.open)).toBe(true)
})
