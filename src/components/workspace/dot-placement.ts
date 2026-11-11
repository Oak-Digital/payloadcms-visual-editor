export type DotPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type PointerSample = { x: number; y: number; time: number }

export function releaseVelocity(samples: PointerSample[], release: PointerSample) {
  const recent = samples.filter((sample) => sample.time >= release.time - 80)
  const first = recent[0]
  const elapsed = first ? release.time - first.time : 0
  if (!first || elapsed <= 0) return { x: 0, y: 0 }
  return { x: (release.x - first.x) / elapsed, y: (release.y - first.y) / elapsed }
}

export function resolveDotPosition(
  x: number,
  y: number,
  velocityX: number,
  velocityY: number,
  width: number,
  height: number,
  displacement: { x: number; y: number },
): DotPosition {
  // Once a drag clearly heads toward a side, slowing at release must not undo it.
  function side(position: number, speed: number, distance: number, extent: number) {
    // Pointer coordinates can differ by a fractional-pixel rounding error.
    if (Math.abs(distance) + 0.001 >= extent * 0.03) return distance > 0
    return position + speed * 650 >= extent / 2
  }
  const right = side(x, velocityX, displacement.x, width)
  const bottom = side(y, velocityY, displacement.y, height)
  return `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`
}

export function dotFlight(
  start: { x: number; y: number },
  target: { x: number; y: number },
  velocity: { x: number; y: number },
  viewport: { width: number; height: number },
) {
  // An underdamped spring starts with the actual release velocity, then settles softly.
  const decay = 8
  const frequency = 6
  const frames: Keyframe[] = []
  let duration = 0
  for (let time = 0; time <= 2000; time += 1000 / 60) {
    const seconds = time / 1000
    const axis = (from: number, to: number, speed: number) => {
      const offset = from - to
      const sine = (speed * 1000 + decay * offset) / frequency
      const position =
        Math.exp(-decay * seconds) *
        (offset * Math.cos(frequency * seconds) + sine * Math.sin(frequency * seconds))
      const rate =
        Math.exp(-decay * seconds) *
        ((sine * frequency - decay * offset) * Math.cos(frequency * seconds) -
          (offset * frequency + decay * sine) * Math.sin(frequency * seconds))
      return { position, rate }
    }
    const x = axis(start.x, target.x, velocity.x)
    const y = axis(start.y, target.y, velocity.y)
    // Keep the whole dot reachable even after a strong throw toward a screen edge.
    const dx =
      time === 0
        ? x.position
        : Math.max(8 - target.x, Math.min(viewport.width - 64 - target.x, x.position))
    const dy =
      time === 0
        ? y.position
        : Math.max(8 - target.y, Math.min(viewport.height - 64 - target.y, y.position))
    frames.push({ transform: `translate(${dx}px, ${dy}px)` })
    duration = time
    if (time >= 250 && Math.hypot(x.position, y.position) < 0.5 && Math.hypot(x.rate, y.rate) < 5)
      break
  }
  frames.push({ transform: 'translate(0, 0)' })
  return { frames, duration: duration + 1000 / 60 }
}
