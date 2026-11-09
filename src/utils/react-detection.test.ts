import { afterEach, expect, it } from 'vitest'
import { clearReactDetectionCache, getReactComponentName, isReactPage } from './react-detection.js'

type Fiber = {
  type: { name: string }
  elementType: { name: string }
  return: Fiber | null
  tag: number
}
const fiber = (name: string, parent: Fiber | null = null): Fiber => ({
  type: { name },
  elementType: { name },
  return: parent,
  tag: 0,
})

afterEach(() => {
  document.body.replaceChildren()
  clearReactDetectionCache()
})

it('detects React after cache reset and returns no component for public HTML', () => {
  const element = document.createElement('div')
  document.body.append(element)
  expect(isReactPage()).toBe(false)
  expect(getReactComponentName(element)).toEqual({ components: [], path: null })
  Object.assign(element, { __reactFiber$test: fiber('App') })
  expect(isReactPage()).toBe(false)
  clearReactDetectionCache()
  expect(isReactPage()).toBe(true)
  element.remove()
  clearReactDetectionCache()
  expect(isReactPage()).toBe(false)
})

it('reports the component hierarchy without leaking cached framework names into filtered modes', () => {
  const element = document.createElement('div')
  element.className = 'product-card'
  Object.assign(element, {
    __reactFiber$test: fiber('ProductCard', fiber('HelperUtil', fiber('ThemeProvider'))),
  })
  document.body.append(element)
  const all = getReactComponentName(element, { mode: 'all' })
  expect(all.path).toBe('<ThemeProvider> <HelperUtil> <ProductCard>')
  expect(getReactComponentName(element, { mode: 'all' })).toBe(all)
  expect(getReactComponentName(element, { mode: 'filtered' }).components).toEqual([
    'ProductCard',
    'HelperUtil',
  ])
  expect(getReactComponentName(element, { mode: 'smart' }).components).toEqual(['ProductCard'])
})
