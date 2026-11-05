import { describe, expect, it } from 'vitest'

import { revisionChanges } from './revisions.js'

describe('revision comparisons', () => {
  it('ignores document timestamps but retains publishing changes', () => {
    expect(
      revisionChanges(
        { _status: 'draft', updatedAt: 'old' },
        { _status: 'published', updatedAt: 'new' },
      ),
    ).toEqual([{ after: 'published', before: 'draft', path: '_status' }])
  })
  it('includes added, deleted and nested content', () => {
    expect(
      revisionChanges(
        { seo: { description: 'Before' }, title: 'Old' },
        { image: 'media-1', seo: { description: 'After' } },
      ),
    ).toEqual(
      expect.arrayContaining([
        { after: undefined, before: 'Old', path: 'title' },
        { after: 'After', before: 'Before', path: 'seo.description' },
        { after: 'media-1', before: undefined, path: 'image' },
      ]),
    )
  })
  it('preserves block ordering in comparisons', () => {
    const before = [{ id: 'a' }, { id: 'b' }]
    const after = [before[1], before[0]]
    expect(revisionChanges({ layout: before }, { layout: after })).toEqual([
      { after, before, path: 'layout' },
    ])
    expect(revisionChanges({ layout: before }, { layout: before })).toEqual([])
  })
})
