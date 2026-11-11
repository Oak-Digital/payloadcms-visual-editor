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
