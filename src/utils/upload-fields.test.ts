import { describe, expect, it, vi } from 'vitest'
import { assertUploadAccess, mediaWhere, uploadTargets, validateMedia } from './upload-fields.js'
import { buildSourceMap } from './source-map.js'

const fields = [
  {
    type: 'blocks',
    name: 'layout',
    blocks: [
      {
        slug: 'hero',
        fields: [
          {
            type: 'group',
            name: 'content',
            fields: [
              {
                type: 'array',
                name: 'slides',
                fields: [{ type: 'upload', name: 'image', relationTo: 'photos', required: true }],
              },
            ],
          },
        ],
      },
    ],
  },
] as never
const data = {
  layout: [
    { id: 'row', blockType: 'hero', content: { slides: [{ image: 'old' }, { image: 'other' }] } },
  ],
}

describe('image field resolution', () => {
  it('resolves exact nested paths, distinct usages and populated IDs', () => {
    expect([...uploadTargets(fields, data).keys()]).toEqual([
      'layout.0.content.slides.0.image',
      'layout.0.content.slides.1.image',
    ])
    expect(buildSourceMap(fields, data)['layout.0.content.slides.1.image']).toEqual({
      type: 'upload',
      value: 'other',
    })
    expect(
      buildSourceMap([{ type: 'upload', name: 'image', relationTo: 'photos' }] as never, {
        image: { id: 3, url: '/file.jpg' },
      }),
    ).toEqual({ image: { type: 'upload', value: 3 } })
  })
  it('excludes read-only ancestors, virtual fields, many uploads and polymorphic uploads', () => {
    expect(
      uploadTargets(
        [
          {
            type: 'group',
            name: 'private',
            admin: { readOnly: true },
            fields: [{ type: 'upload', name: 'image', relationTo: 'photos' }],
          },
          { type: 'upload', name: 'gallery', relationTo: 'photos', hasMany: true },
          { type: 'upload', name: 'virtual', relationTo: 'photos', virtual: true },
        ] as never,
        { private: { image: 'x' }, gallery: ['x'], virtual: 'x' },
      ).size,
    ).toBe(0)
  })
  it('checks ancestor access and contextual dynamic filters', async () => {
    const deny = vi.fn().mockResolvedValue(false)
    const filter = vi.fn().mockResolvedValue({ approved: { equals: true } })
    const target = uploadTargets(
      [
        {
          type: 'group',
          name: 'group',
          access: { update: deny },
          fields: [{ type: 'upload', name: 'image', relationTo: 'photos', filterOptions: filter }],
        },
      ] as never,
      { group: { image: 'old' } },
    ).get('group.image')!
    const req = {
      user: { id: 'editor' },
      payload: {
        config: { collections: [{ slug: 'photos', upload: { mimeTypes: ['image/png'] } }] },
      },
    } as never
    await expect(assertUploadAccess(target, req, data, 'page')).rejects.toThrow(
      'Field access denied',
    )
    expect(await mediaWhere(target, req, data, 'page')).toEqual({
      and: [
        { mimeType: { contains: 'image/' } },
        { or: [{ mimeType: { equals: 'image/png' } }] },
        { approved: { equals: true } },
      ],
    })
    expect(filter).toHaveBeenCalledWith(
      expect.objectContaining({ relationTo: 'photos', siblingData: { image: 'old' }, data, req }),
    )
  })
  it('rejects missing, non-image, forbidden and required empty selections', async () => {
    const target = uploadTargets(fields, data).get('layout.0.content.slides.0.image')!
    const find = vi.fn().mockResolvedValue({ docs: [] })
    const req = {
      payload: {
        find,
        config: { collections: [{ slug: 'photos', upload: { mimeTypes: ['image/png'] } }] },
      },
    } as never
    await expect(validateMedia(target, null, req, data, 'page')).rejects.toThrow('required')
    await expect(validateMedia(target, 'missing', req, data, 'page')).rejects.toThrow(
      'inaccessible',
    )
    find.mockResolvedValue({ docs: [{ id: 'video', mimeType: 'video/mp4' }] })
    await expect(validateMedia(target, 'video', req, data, 'page')).rejects.toThrow('inaccessible')
    find.mockResolvedValue({ docs: [{ id: 'image', mimeType: 'image/png' }] })
    await expect(validateMedia(target, 'image', req, data, 'page')).resolves.toBeUndefined()
    expect(find).toHaveBeenLastCalledWith(
      expect.objectContaining({ collection: 'photos', overrideAccess: false, req }),
    )
  })
})
