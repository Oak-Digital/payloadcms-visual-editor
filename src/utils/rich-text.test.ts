import { describe, expect, it } from 'vitest'
import type { Field } from 'payload'
import { DecoratorNode, type NodeKey } from '@payloadcms/richtext-lexical/lexical'
import { HeadingNode, QuoteNode } from '@payloadcms/richtext-lexical/lexical/rich-text'
import { ListNode, ListItemNode } from '@payloadcms/richtext-lexical/lexical/list'
import { assertSupportedRichText, resolveField, assertFieldAccess } from './rich-text.js'
import { buildSourceMap } from './source-map.js'

class EmbedNode extends DecoratorNode<null> {
  __payload: Record<string, unknown>
  constructor(payload: Record<string, unknown>, key?: NodeKey) {
    super(key)
    this.__payload = payload
  }
  static getType() {
    return 'host-embed'
  }
  static clone(node: EmbedNode) {
    return new EmbedNode(node.__payload, node.__key)
  }
  static importJSON(node: any) {
    return new EmbedNode(node.payload)
  }
  exportJSON() {
    return { ...super.exportJSON(), payload: this.__payload }
  }
  createDOM() {
    return document.createElement('span')
  }
  updateDOM() {
    return false
  }
  decorate() {
    return null
  }
}

const text = {
  type: 'text',
  version: 1,
  text: 'Rich text',
  format: 3,
  detail: 0,
  mode: 'normal',
  style: 'color:red',
}
const paragraph = {
  type: 'paragraph',
  version: 1,
  children: [text],
  format: '',
  indent: 0,
  direction: null,
  textFormat: 3,
  textStyle: 'color:red',
}
const value = {
  root: { type: 'root', version: 1, children: [paragraph], format: '', indent: 0, direction: null },
}
const field = {
  name: 'body',
  type: 'richText',
  editor: {
    editorConfig: {
      features: {
        nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, EmbedNode].map((node) => ({
          node,
        })),
      },
    },
  },
} as unknown as Field

describe('structured rich-text editing', () => {
  it('preserves formatting and styles through the configured node classes', () => {
    const before = structuredClone(value)
    expect(() => assertSupportedRichText(field, value)).not.toThrow()
    expect(value).toEqual(before)
  })
  it('preserves lists and embedded data when the host registers those node classes', () => {
    const rich = {
      root: {
        ...value.root,
        children: [
          {
            type: 'list',
            version: 1,
            format: '',
            indent: 0,
            direction: null,
            listType: 'bullet',
            start: 1,
            tag: 'ul',
            children: [
              {
                type: 'listitem',
                version: 1,
                format: '',
                indent: 0,
                direction: null,
                value: 1,
                children: [text],
              },
            ],
          },
          {
            type: 'host-embed',
            version: 1,
            payload: { id: 'asset', caption: 'Keep me', options: { focalX: 30 } },
          },
        ],
      },
    }
    const before = structuredClone(rich)
    expect(() => assertSupportedRichText(field, rich)).not.toThrow()
    expect(rich).toEqual(before)
  })
  it('includes unnamed tab and row indexes required by Payload rendering', () => {
    const fields: Field[] = [
      { type: 'tabs', tabs: [{ label: 'Content', fields: [{ type: 'row', fields: [field] }] }] },
    ]
    expect(resolveField(fields, { body: value }, 'body')?.schemaPath).toBe('_index-0-0-0.body')
  })
  it('rejects unknown nodes and properties that would be silently discarded', () => {
    expect(() =>
      assertSupportedRichText(field, {
        root: { ...value.root, children: [{ type: 'unavailable-embed', version: 1 }] },
      }),
    ).toThrow()
    expect(() =>
      assertSupportedRichText(field, { root: { ...value.root, customData: 'must survive' } }),
    ).toThrow('cannot round-trip')
    expect(() => assertSupportedRichText(field, 'flattened')).toThrow()
  })
  it('resolves groups, arrays and block instances to the configured schema', () => {
    const fields: Field[] = [
      {
        name: 'layout',
        type: 'blocks',
        blocks: [
          {
            slug: 'paragraph',
            fields: [
              {
                name: 'group',
                type: 'group',
                fields: [{ name: 'rows', type: 'array', fields: [field] }],
              },
            ],
          },
        ],
      },
    ]
    const doc = {
      layout: [{ id: 'a', blockType: 'paragraph', group: { rows: [{ id: 'b', body: value }] } }],
    }
    const resolved = resolveField(fields, doc, 'layout.0.group.rows.0.body')!
    expect(resolved.schemaPath).toBe('layout.paragraph.group.rows.body')
    expect(resolved.value).toEqual(value)
    expect(buildSourceMap(fields, doc)).toEqual({
      'layout.0.group.rows.0.body': { type: 'richText' },
    })
    expect(resolveField(fields, doc, 'layout.1.group.rows.0.body')).toBeUndefined()
  })
  it('rejects ancestor and field update access before invoking a mutation', async () => {
    const fields: Field[] = [
      { name: 'group', type: 'group', access: { update: () => false }, fields: [field] },
    ]
    const doc = { id: 'doc', group: { body: value } }
    const resolved = resolveField(fields, doc, 'group.body')!
    await expect(assertFieldAccess(resolved, doc, {} as never, value)).rejects.toThrow(
      'access denied',
    )
  })
})
