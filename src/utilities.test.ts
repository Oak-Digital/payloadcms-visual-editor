import { describe, expect, it } from 'vitest'
import { bindSourceMap, editableField, editableValue } from './utilities.js'
import { buildSourceMap } from './utils/source-map.js'
import { applyPatchesToDocument } from './utils/payloodcms-patches.js'

const owner = { collection: 'pages', id: 'page', locale: 'en', hasDrafts: true }
describe('rendered field bindings', () => {
  it('keeps repeated media usages independent through filtering and reordering', () => {
    const image = { id: 'shared-image', url: '/same.jpg' }
    const original = { layout: [{ slides: [{ image }, { image }] }] }
    const bound = bindSourceMap(
      original,
      {
        'layout.0.slides.0.image': { type: 'upload', value: image.id },
        'layout.0.slides.1.image': { type: 'upload', value: image.id },
      },
      owner,
    )
    const selected = bound.layout[0].slides.filter((_, index) => index === 1)[0]
    expect(editableValue(selected.image)?.['data-payload-path']).toBe('layout.0.slides.1.image')
    expect(editableField(selected, 'image')?.['data-payload-document']).toBe(JSON.stringify(owner))
    expect(editableValue(original.layout[0].slides[0].image)).toBeUndefined()
    expect(bound.layout[0].slides[0].image).not.toBe(selected.image)
  })
  it('binds absent optional overrides from the field schema without inventing parents', () => {
    const data = { slides: [{}] }
    const map = buildSourceMap(
      [
        {
          type: 'array',
          name: 'slides',
          fields: [
            { type: 'text', name: 'heading' },
            { type: 'upload', name: 'image', relationTo: 'media' },
          ],
        },
      ],
      data,
    )
    const bound = bindSourceMap(data, map, owner)
    expect(editableField(bound.slides[0], 'image')?.['data-payload-type']).toBe('upload')
    expect(
      applyPatchesToDocument(data, [{ path: 'slides.0.image', value: 'new' }], Object.keys(map)),
    ).toEqual({ slides: [{ image: 'new' }] })
    expect(() =>
      applyPatchesToDocument(data, [{ path: 'slides.0.unmapped', value: 'new' }], Object.keys(map)),
    ).toThrow()
    expect(() =>
      applyPatchesToDocument(data, [{ path: 'slides.2.image', value: 'new' }], Object.keys(map)),
    ).toThrow()
  })
  it('returns public content unchanged when no source map is present', () => {
    const document = { title: 'Public' }
    expect(bindSourceMap(document, undefined, owner)).toBe(document)
    expect(editableField(document, 'title')).toBeUndefined()
  })
})

it('does not resolve malformed ownership to the parent page', async () => {
  const { fieldDocument } = await import('./utils/field-target.js')
  const element = document.createElement('img')
  expect(fieldDocument(element, owner)).toEqual(owner)
  element.dataset.payloadDocument = '{invalid'
  expect(fieldDocument(element, owner)).toBeNull()
  element.dataset.payloadDocument = JSON.stringify({
    id: 'shared',
    collection: 'layouts',
    locale: 'en',
  })
  expect(fieldDocument(element, owner)?.collection).toBe('layouts')
})
