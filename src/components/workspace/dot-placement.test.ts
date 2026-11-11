import { describe, expect, it } from 'vitest'
import { resolveDotPosition } from './dot-placement.js'

describe('dot placement', () => {
  it.each([
    [100, 100, 'top-left'],
    [900, 100, 'top-right'],
    [100, 700, 'bottom-left'],
    [900, 700, 'bottom-right'],
  ] as const)('snaps a slow drag at %s, %s to %s', (x, y, corner) => {
    expect(resolveDotPosition(x, y, 0, 0, 1000, 800)).toBe(corner)
  })

  it.each([
    [-2, -2, 'top-left'],
    [2, -2, 'top-right'],
    [-2, 2, 'bottom-left'],
    [2, 2, 'bottom-right'],
  ] as const)('projects a throw with velocity %s, %s to %s', (vx, vy, corner) => {
    expect(resolveDotPosition(550, 450, vx, vy, 1000, 800)).toBe(corner)
  })

  it('handles releases outside the viewport', () => {
    expect(resolveDotPosition(-200, 1200, 0, 0, 1000, 800)).toBe('bottom-left')
  })
})

describe('early release', () => {
  it.each([
    [1300, 80, -0.4, 0.03, 'top-left'],
    [140, 80, 0.4, 0.03, 'top-right'],
    [80, 140, 0.03, 0.4, 'bottom-left'],
    [1360, 860, 0.03, -0.4, 'top-right'],
    [1300, 140, -0.4, 0.4, 'bottom-left'],
  ] as const)('sends a short throw toward its intended corner', (x, y, vx, vy, corner) => {
    expect(resolveDotPosition(x, y, vx, vy, 1440, 1000)).toBe(corner)
    expect(resolveDotPosition((x / 1440) * 3840, (y / 1000) * 2160, vx, vy, 3840, 2160)).toBe(
      corner,
    )
  })

  it('keeps slow releases near their current corner', () => {
    expect(resolveDotPosition(1300, 80, -0.1, 0.02, 1440, 1000)).toBe('top-right')
  })
})
