import { expect, it } from 'vitest'
import { buildSourceMap } from './source-map.js'

it('discovers schema controls only for the block sidebar, including absent groups', () => {
  const fields: import('payload').Field[] = [
    { type: 'radio', name: 'order', options: ['left', 'right'] },
    { type: 'checkbox', name: 'addLink' },
    {
      type: 'group',
      name: 'link',
      fields: [
        { type: 'radio', name: 'type', options: ['reference', 'custom'] },
        { type: 'text', name: 'url' },
        { type: 'relationship', name: 'relation', relationTo: ['pages'] },
      ],
    },
    { type: 'checkbox', name: 'protected', admin: { readOnly: true } },
  ]
  expect(buildSourceMap(fields, {})).toEqual({})
  expect(buildSourceMap(fields, {}, true)).toEqual({
    order: { type: 'control' },
    addLink: { type: 'control' },
    'link.type': { type: 'control' },
    'link.url': '',
    'link.relation': { type: 'control' },
  })
})
