import { describe, expect, it } from 'vitest'

import { remapArrangePath } from './arrange.js'

describe('selection after saving block order', () => {
  const rows = {
    layout: [
      { id: 'hero', label: 'Hero' },
      { id: 'body', label: 'Body' },
    ],
  }
  it('follows the selected block without changing its child field', () => {
    expect(remapArrangePath('layout.0.heading', rows, { layout: ['body', 'hero'] })).toBe(
      'layout.1.heading',
    )
    expect(remapArrangePath('title', rows, { layout: ['body', 'hero'] })).toBe('title')
  })
  it('maps nested reorders against original paths', () => {
    expect(
      remapArrangePath(
        'layout.0.blocks.1.heading',
        {
          ...rows,
          'layout.0.blocks': [
            { id: 'a', label: 'A' },
            { id: 'b', label: 'B' },
          ],
        },
        { layout: ['body', 'hero'], 'layout.0.blocks': ['b', 'a'] },
      ),
    ).toBe('layout.1.blocks.0.heading')
  })
})
