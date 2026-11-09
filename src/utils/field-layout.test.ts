import type { Field } from 'payload'

import { expect, it } from 'vitest'

import { buildFieldLayout, findFieldLayout } from './field-layout.js'

it('preserves sections, rows, named tabs and nested items without inventing data paths', () => {
  const fields: Field[] = [
    {
      type: 'collapsible',
      fields: [
        {
          type: 'row',
          fields: [
            { name: 'title', type: 'text' },
            { name: 'enabled', type: 'checkbox' },
          ],
        },
        {
          type: 'tabs',
          tabs: [
            {
              name: 'details',
              fields: [{ name: 'items', type: 'array', fields: [{ name: 'label', type: 'text' }] }],
              label: 'Details',
            },
          ],
        },
      ],
      label: 'Content',
    },
  ]
  const document = { details: { items: [{ id: 'a', label: 'First' }] }, title: 'Page' }
  const layout = buildFieldLayout(fields, document, {
    'details.items.0.label': { type: 'text', value: 'First' },
    enabled: { type: 'checkbox' },
    title: { type: 'text', value: 'Page' },
  })
  expect(layout[0]).toMatchObject({ type: 'collapsible', label: 'Content' })
  expect(layout[0].children?.[0]).toMatchObject({
    type: 'row',
    children: [{ path: 'title' }, { path: 'enabled' }],
  })
  expect(findFieldLayout(layout, 'details')).toMatchObject({ type: 'tab', label: 'Details' })
  expect(findFieldLayout(layout, 'details.items.0')).toMatchObject({
    type: 'item',
    children: [{ path: 'details.items.0.label' }],
    label: 'First',
  })
})

it('isolates block schemas and does not use inaccessible or hidden content as item labels', () => {
  const fields: Field[] = [
    {
      name: 'layout',
      type: 'blocks',
      blocks: [
        { slug: 'intro', fields: [{ name: 'heading', type: 'text' }] },
        {
          slug: 'process',
          fields: [
            {
              name: 'stages',
              type: 'array',
              fields: [
                { name: 'title', type: 'text' },
                { name: 'key', type: 'select', options: ['design'] },
              ],
            },
          ],
        },
      ],
    },
  ]
  const layout = buildFieldLayout(
    fields,
    {
      layout: [
        { id: 'a', blockType: 'intro', heading: 'Introduction', stages: [{ title: 'Stale data' }] },
        { id: 'b', blockType: 'process', stages: [{ key: 'design', title: 'Private' }] },
      ],
    },
    {
      'layout.0.heading': { type: 'text', value: 'Introduction' },
      'layout.1.stages.0.key': {
        type: 'select',
        options: [{ label: 'The Design', value: 'design' }],
        value: 'design',
      },
      'layout.1.stages.0.title': { type: 'text', hidden: true, value: 'Private' },
    },
  )
  expect(findFieldLayout(layout, 'layout.0')?.children).toEqual([
    { type: 'text', label: 'Heading', path: 'layout.0.heading' },
  ])
  expect(findFieldLayout(layout, 'layout.1.stages.0')?.label).toBe('The Design')
  expect(JSON.stringify(layout)).not.toContain('Private')
  expect(JSON.stringify(layout)).not.toContain('Stale data')
})
