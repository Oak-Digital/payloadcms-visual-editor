import { describe, expect, it } from 'vitest'
import { previewImages } from './preview.js'
import type { Annotation } from '../../types.js'

describe('pending image preview', () => {
  it('updates only the selected field and restores responsive sources', () => {
    document.body.innerHTML =
      '<picture><source data-payload-type="upload" data-payload-path="mobile" srcset="mobile.jpg"><img data-payload-type="upload" data-payload-path="desktop" src="old.jpg" srcset="old-2x.jpg 2x" sizes="100vw" alt="Original"></picture><img data-payload-type="upload" data-payload-path="other" src="old.jpg">'
    const restore = previewImages([
      {
        payloadCMS: { path: 'desktop', value: 'id' },
        media: { id: 'id', url: '/new.jpg', alt: 'New' },
      },
    ] as Annotation[])
    const image = document.querySelector('img')!
    expect(image.getAttribute('src')).toBe('/new.jpg')
    expect(image.hasAttribute('srcset')).toBe(false)
    expect(document.querySelector('source')?.getAttribute('srcset')).toBe('mobile.jpg')
    expect(document.querySelector('[data-payload-path="other"]')?.getAttribute('src')).toBe(
      'old.jpg',
    )
    restore()
    expect(image.getAttribute('src')).toBe('old.jpg')
    expect(image.getAttribute('srcset')).toBe('old-2x.jpg 2x')
    expect(image.alt).toBe('Original')
  })
})

it('isolates the same field path in different documents', () => {
  const page = { id: 'page', collection: 'pages', locale: 'en', hasDrafts: true }
  const shared = { ...page, id: 'shared', collection: 'layouts' }
  document.body.innerHTML =
    '<img data-payload-type="upload" data-payload-path="image" src="page.jpg"><img data-payload-type="upload" data-payload-path="image" src="shared.jpg">'
  const images = document.querySelectorAll('img')
  images[0].dataset.payloadDocument = JSON.stringify(page)
  images[1].dataset.payloadDocument = JSON.stringify(shared)
  const restore = previewImages(
    [
      {
        payloadCMS: { path: 'image', value: 'new', document: shared },
        media: { id: 'new', url: '/new.jpg' },
      },
    ] as Annotation[],
    document,
    page,
  )
  expect(images[0].getAttribute('src')).toBe('page.jpg')
  expect(images[1].getAttribute('src')).toBe('/new.jpg')
  restore()
  expect(images[1].getAttribute('src')).toBe('shared.jpg')
})
