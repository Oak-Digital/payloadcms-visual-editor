import { describe, expect, it } from 'vitest'
import { publishedChanges } from './publish-review.js'

const richText = (text: string) => ({
  root: {
    type: 'root',
    children: [{ type: 'paragraph', textFormat: 0, children: [{ type: 'text', text, format: 1 }] }],
  },
})

describe('publish review', () => {
  it('groups rich text into one readable field change while preserving its content', () => {
    const before = {
      layout: [
        { id: 'a', blockType: 'textSection', blockName: 'Introduction', richText: richText('Old') },
      ],
    }
    const after = { layout: [{ ...before.layout[0], richText: richText('New') }] }
    expect(publishedChanges(before, after)).toEqual([
      {
        path: 'layout.0.richText',
        label: 'Sections › Introduction › Rich Text',
        before: before.layout[0].richText,
        after: after.layout[0].richText,
      },
    ])
  })
  it('retains removals and formatting-only changes', () => {
    expect(publishedChanges({ title: 'Old' }, {})).toEqual([
      { path: 'title', label: 'Title', before: 'Old', after: undefined },
    ])
    const before = richText('Same')
    const after = structuredClone(before)
    after.root.children[0].children[0].format = 2
    expect(publishedChanges({ body: before }, { body: after })).toHaveLength(1)
  })
})
