import { describe, expect, it } from 'vitest'
import { markerInCapture } from './screenshot.js'

describe('screenshot marker coordinates', () => {
  it('accounts for a scrolled area and downscaling', () => {
    expect(
      markerInCapture({ x: 400, y: 1400 }, { x: 200, y: 1200, width: 800, height: 400 }, 400, 200),
    ).toEqual({ x: 100, y: 100 })
  })
  it('keeps a full-page marker at its document position', () => {
    expect(
      markerInCapture({ x: 600, y: 3000 }, { x: 0, y: 0, width: 1200, height: 6000 }, 384, 1920),
    ).toEqual({ x: 192, y: 960 })
  })
})
