import { describe, expect, it } from 'vitest'
import { dotFlight, releaseVelocity, resolveDotPosition } from './dot-placement.js'

describe('release momentum', () => {
  it('uses recent direction instead of the overall drag direction', () => {
    expect(
      releaseVelocity(
        [
          { x: 0, y: 0, time: 0 },
          { x: 300, y: 20, time: 200 },
          { x: 260, y: 30, time: 220 },
        ],
        { x: 220, y: 40, time: 240 },
      ),
    ).toEqual({ x: -2, y: 0.5 })
  })
  it('loses momentum after a pause', () => {
    expect(
      releaseVelocity(
        [
          { x: 0, y: 0, time: 0 },
          { x: 100, y: 50, time: 40 },
        ],
        { x: 100, y: 50, time: 250 },
      ),
    ).toEqual({ x: 0, y: 0 })
  })
  it('includes the final movement reported on pointer up', () => {
    expect(
      releaseVelocity(
        [
          { x: 0, y: 0, time: 0 },
          { x: 20, y: 10, time: 20 },
        ],
        { x: 60, y: 30, time: 40 },
      ),
    ).toEqual({ x: 1.5, y: 0.75 })
  })
  it('distinguishes slow and fast releases from the same position', () => {
    expect(resolveDotPosition(1200, 100, -0.2, 0, 1440, 1000)).toBe('top-right')
    expect(resolveDotPosition(1200, 100, -1.5, 0, 1440, 1000)).toBe('top-left')
  })
  it.each([
    [-2, -2, 'top-left'],
    [2, -2, 'top-right'],
    [-2, 2, 'bottom-left'],
    [2, 2, 'bottom-right'],
  ] as const)('projects the release direction to %s, %s', (vx, vy, corner) => {
    expect(resolveDotPosition(720, 500, vx, vy, 1440, 1000)).toBe(corner)
  })
})

function point(frame: Keyframe) {
  const values = String(frame.transform)
    .match(/-?[\d.]+/g)!
    .map(Number)
  return { x: values[0], y: values[1] }
}

describe('throw trajectory', () => {
  const start = { x: 600, y: 300 }
  const target = { x: 24, y: 24 }
  const viewport = { width: 1440, height: 1000 }
  it('moves faster initially when released faster toward the same corner', () => {
    const slow = dotFlight(start, target, { x: -0.3, y: 0 }, viewport)
    const fast = dotFlight(start, target, { x: -2, y: 0 }, viewport)
    expect(point(fast.frames[1]).x).toBeLessThan(point(slow.frames[1]).x)
    expect(fast.duration).not.toBe(slow.duration)
  })
  it('follows release direction before curving toward the corner', () => {
    const flight = dotFlight(start, target, { x: -1, y: 2 }, viewport)
    expect(point(flight.frames[1]).y).toBeGreaterThan(start.y - target.y)
    expect(flight.frames.at(-1)?.transform).toBe('translate(0, 0)')
  })
  it('keeps extreme throws within the viewport', () => {
    const flight = dotFlight(start, target, { x: -20, y: -20 }, viewport)
    for (const frame of flight.frames) {
      const p = point(frame)
      expect(p.x + target.x).toBeGreaterThanOrEqual(8)
      expect(p.y + target.y).toBeGreaterThanOrEqual(8)
      expect(p.x + target.x).toBeLessThanOrEqual(viewport.width - 64)
      expect(p.y + target.y).toBeLessThanOrEqual(viewport.height - 64)
    }
  })
})
