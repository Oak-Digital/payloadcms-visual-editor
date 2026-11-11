import { describe, expect, it } from 'vitest'
import { drawScreenshotMarker, markerInCapture } from './screenshot.js'

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

it('draws in image pixels despite the renderer crop and scale transform', () => {
  let transform = [0.5, 0, 0, 0.5, -100, -600]
  let saved: number[] = []
  let drawn: number[] = []
  const context = {
    save: () => {
      saved = [...transform]
    },
    setTransform: (...values: number[]) => {
      transform = values
    },
    beginPath: () => {},
    arc: (x: number, y: number, radius: number) => {
      drawn = [
        x * transform[0]! + transform[4]!,
        y * transform[3]! + transform[5]!,
        radius * transform[0]!,
      ]
    },
    fill: () => {},
    stroke: () => {},
    restore: () => {
      transform = saved
    },
  }
  const canvas = {
    width: 400,
    height: 200,
    getContext: () => context,
  } as unknown as HTMLCanvasElement
  drawScreenshotMarker(canvas, { x: 400, y: 1400 }, { x: 200, y: 1200, width: 800, height: 400 })
  expect(drawn).toEqual([100, 100, 9])
  expect(transform).toEqual([0.5, 0, 0, 0.5, -100, -600])
})
