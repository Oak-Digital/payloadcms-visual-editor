import type { Field, PayloadRequest } from 'payload'
import { expect, it, vi } from 'vitest'
import { layoutReferences, layoutUsages } from './layout-references.js'

const fields: Field[] = [
  {
    type: 'tabs',
    tabs: [
      {
        label: 'Content',
        fields: [
          {
            name: 'layout',
            type: 'blocks',
            blocks: [
              {
                slug: 'reference',
                fields: [
                  {
                    name: 'source',
                    type: 'relationship',
                    relationTo: 'layouts',
                    custom: { visualEditorLayout: 'layout' },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]
it('finds only opted-in layout references through tabs and blocks', () => {
  expect(layoutReferences(fields)).toEqual([
    { path: 'layout.source', collection: 'layouts', layoutPath: 'layout' },
  ])
  expect(
    layoutReferences([{ name: 'other', type: 'relationship', relationTo: 'layouts' }]),
  ).toEqual([])
})
it('merges accessible published and draft usages without counting unpublished rows as public', async () => {
  const find = vi.fn(async ({ draft }) => ({
    docs: draft
      ? [
          { id: 'both', title: 'Both', _status: 'draft' },
          { id: 'draft', title: 'Draft', _status: 'draft' },
        ]
      : [
          { id: 'both', title: 'Both', _status: 'published' },
          { id: 'draft', title: 'Draft', _status: 'draft' },
        ],
    hasNextPage: draft,
  }))
  const req = {
    payload: {
      config: {
        collections: [
          { slug: 'pages', admin: { useAsTitle: 'title' }, fields },
          { slug: 'disabled', fields },
        ],
      },
      find,
    },
  } as unknown as PayloadRequest
  const result = await layoutUsages(req, { pages: true }, 'layouts', 'source')
  expect(result).toEqual({
    usages: [
      { collection: 'pages', id: 'both', label: 'Both', draft: true, published: true },
      { collection: 'pages', id: 'draft', label: 'Draft', draft: true, published: false },
    ],
    hasMore: true,
  })
  expect(find).toHaveBeenCalledTimes(2)
  for (const [options] of find.mock.calls)
    expect(options).toMatchObject({
      overrideAccess: false,
      req,
      where: { or: [{ 'layout.source': { equals: 'source' } }] },
    })
})

it('keeps layout editing available when usage collections deny access', async () => {
  const req = {
    payload: {
      config: { collections: [{ slug: 'pages', fields }] },
      find: vi.fn(async () => {
        throw { status: 403 }
      }),
    },
  } as unknown as PayloadRequest
  expect(await layoutUsages(req, { pages: true }, 'layouts', 'source')).toEqual({
    usages: [],
    hasMore: false,
    incomplete: true,
  })
})
