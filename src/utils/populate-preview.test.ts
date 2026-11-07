import type { Field, PayloadRequest } from 'payload'
import { expect, it, vi } from 'vitest'
import { populatePreview } from './populate-preview.js'

it('populates nested media and relationships using current-user access', async () => {
  const fields: Field[] = [
    {
      type: 'tabs',
      tabs: [
        {
          name: 'content',
          label: 'Content',
          fields: [
            {
              name: 'rows',
              type: 'array',
              fields: [
                { name: 'image', type: 'upload', relationTo: 'media' },
                { name: 'products', type: 'relationship', relationTo: 'products', hasMany: true },
              ],
            },
          ],
        },
      ],
    },
  ]
  const findByID = vi.fn(async ({ id }: { id: string }) => {
    if (id === 'hidden') throw new Error('Denied')
    return { id, title: 'Visible' }
  })
  const req = { user: { id: 'editor' }, payload: { findByID } } as unknown as PayloadRequest
  const original = {
    content: { rows: [{ id: 'row', image: 'photo', products: ['visible', 'hidden'] }] },
  }
  const result = await populatePreview(fields, original, req)
  expect(result.content.rows[0]).toEqual({
    id: 'row',
    image: { id: 'photo', title: 'Visible' },
    products: [{ id: 'visible', title: 'Visible' }, null],
  })
  expect(original.content.rows[0].image).toBe('photo')
  for (const [options] of findByID.mock.calls)
    expect(options).toMatchObject({ overrideAccess: false, req, draft: true })
})

it('preserves populated fields across unnamed tabs and layout containers', async () => {
  const fields: Field[] = [
    {
      type: 'tabs',
      tabs: [
        { label: 'Content', fields: [{ name: 'image', type: 'upload', relationTo: 'media' }] },
        { label: 'SEO', fields: [{ name: 'title', type: 'text' }] },
      ],
    },
    { type: 'row', fields: [{ name: 'caption', type: 'text' }] },
  ]
  const req = {
    payload: { findByID: vi.fn(async () => ({ id: 'photo', url: '/photo.jpg' })) },
  } as unknown as PayloadRequest
  const result = await populatePreview(
    fields,
    { image: 'photo', title: 'SEO', caption: 'Caption' },
    req,
  )
  expect(result.image).toEqual({ id: 'photo', url: '/photo.jpg' })
  expect(result.title).toBe('SEO')
})
