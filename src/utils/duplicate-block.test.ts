import type { Field } from 'payload'
import { expect, it } from 'vitest'
import { duplicateBlock } from './duplicate-block.js'

it('gives nested rows deterministic fresh IDs without changing linked media or the source', () => {
  const fields: Field[] = [
    {
      name: 'slides',
      type: 'array',
      fields: [
        { name: 'image', type: 'upload', relationTo: 'media' },
        { name: 'links', type: 'array', fields: [{ name: 'label', type: 'text' }] },
      ],
    },
  ]
  const source = {
    id: 'source',
    slides: [
      {
        id: 'slide',
        image: { id: 'media-1', url: '/watch.jpg' },
        links: [{ id: 'link', label: 'Read' }],
      },
    ],
  }
  const copy = duplicateBlock(fields, source, 'copy') as typeof source
  expect(copy.id).toBe('copy')
  expect(copy.slides[0].id).not.toBe('slide')
  expect(copy.slides[0].links[0].id).not.toBe('link')
  expect(copy.slides[0].image.id).toBe('media-1')
  expect(copy).toEqual(duplicateBlock(fields, source, 'copy'))
  expect(copy.slides[0].id).not.toBe(
    (duplicateBlock(fields, source, 'other') as typeof source).slides[0].id,
  )
  copy.slides[0].links[0].label = 'Changed'
  expect(source.slides[0].links[0].label).toBe('Read')
})
it('handles named tabs and nested block schemas', () => {
  const fields: Field[] = [
    {
      type: 'tabs',
      tabs: [
        {
          name: 'content',
          label: 'Content',
          fields: [
            {
              name: 'sections',
              type: 'blocks',
              blocks: [{ slug: 'paragraph', fields: [{ name: 'title', type: 'text' }] }],
            },
          ],
        },
      ],
    },
  ]
  const copy = duplicateBlock(
    fields,
    { content: { sections: [{ id: 'old', blockType: 'paragraph', title: 'Heading' }] } },
    'copy',
  ) as any
  expect(copy.content.sections[0].id).toMatch(/^[a-f0-9]{24}$/)
  expect(copy.content.sections[0].title).toBe('Heading')
})
