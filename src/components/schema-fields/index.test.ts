import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

import type { FieldLayout } from '../../utils/field-layout.js'

import { SchemaFields } from './index.js'
import { ScalarField } from './scalar-field.js'

it('opens the selected tab and collapsed section, and hides groups whose fields are unavailable', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const nodes: FieldLayout[] = [
    {
      type: 'tabs',
      children: [
        {
          type: 'tab',
          children: [{ type: 'text', label: 'Title', path: 'title' }],
          label: 'First',
          path: '@first',
        },
        {
          type: 'tab',
          children: [
            {
              type: 'collapsible',
              children: [{ type: 'text', label: 'Label', path: 'link.label' }],
              collapsed: true,
              label: 'Link',
              path: '@group',
            },
          ],
          label: 'Second',
          path: '@second',
        },
      ],
      label: '',
      path: '@tabs',
    },
    {
      type: 'group',
      children: [{ type: 'text', label: 'Secret', path: 'secret.value' }],
      label: 'Secret group',
      path: 'secret',
    },
  ]
  const props = {
    nodes,
    onOpen: vi.fn(),
    renderField: (node: FieldLayout) =>
      createElement(ScalarField, { type: 'text', label: node.label, onChange: vi.fn(), value: '' }),
    visible: (node: FieldLayout) => ['link.label', 'title'].includes(node.path),
  }
  try {
    await act(() => Promise.resolve(root.render(createElement(SchemaFields, props))))
    expect(container.querySelector('[aria-label="Title"]')).toBeTruthy()
    expect(container.textContent).not.toContain('Secret')
    await act(() =>
      Promise.resolve(
        root.render(createElement(SchemaFields, { ...props, activePath: 'link.label' })),
      ),
    )
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
    expect(container.querySelector('details')?.open).toBe(true)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Label')
    expect(container.querySelector('button[aria-pressed="true"]')?.textContent).toBe('Second')
  } finally {
    await act(() => Promise.resolve(root.unmount()))
    container.remove()
    vi.unstubAllGlobals()
  }
})
