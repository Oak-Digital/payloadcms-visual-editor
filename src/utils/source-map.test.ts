import { describe, expect, it } from 'vitest'
import { buildSourceMap } from './source-map.js'
import { buildPatchedUpdateData, generatePatches } from './payloodcms-patches.js'

describe('layout source maps', () => {
  it('maps text in blocks and arrays without exposing structural or read-only fields', () => {
    expect(
      buildSourceMap(
        [
          {
            type: 'blocks',
            name: 'layout',
            blocks: [
              {
                slug: 'hero',
                fields: [
                  { type: 'text', name: 'heading' },
                  { type: 'text', name: 'internal', admin: { readOnly: true } },
                  { type: 'array', name: 'links', fields: [{ type: 'text', name: 'label' }] },
                ],
              },
            ],
          },
        ],
        {
          layout: [
            {
              blockType: 'hero',
              id: 'row',
              heading: 'Hello',
              internal: 'Private',
              links: [{ label: 'Explore', id: 'link' }],
            },
          ],
        },
      ),
    ).toEqual({ 'layout.0.heading': 'Hello', 'layout.0.links.0.label': 'Explore' })
  })
  it('preserves sibling array rows and fields', () => {
    expect(
      buildPatchedUpdateData(
        {
          layout: [
            { heading: 'First', id: 'a' },
            { heading: 'Second', id: 'b' },
          ],
        },
        [{ path: 'layout.0.heading', value: 'Changed' }],
      ),
    ).toEqual({
      layout: [
        { heading: 'Changed', id: 'a' },
        { heading: 'Second', id: 'b' },
      ],
    })
  })
  it('rejects prototype traversal', () => {
    expect(() =>
      buildPatchedUpdateData({}, [{ path: '__proto__.polluted', value: 'bad' }]),
    ).toThrow('Invalid patch path')
    expect({}).not.toHaveProperty('polluted')
  })
  it('does not send ordinary feedback as a CMS patch', () => {
    expect(
      generatePatches([
        { payloadCMS: { path: '', value: 'Feedback' } },
        { payloadCMS: { path: 'title', value: 'Changed' } },
      ] as never),
    ).toEqual([{ path: 'title', value: 'Changed' }])
  })
})
