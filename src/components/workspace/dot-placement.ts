export type DotPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export function resolveDotPosition(
  x: number,
  y: number,
  velocityX: number,
  velocityY: number,
  width: number,
  height: number,
  displacementX = 0,
  displacementY = 0,
): DotPosition {
  const speedThreshold = Math.max(0.25, Math.max(Math.abs(velocityX), Math.abs(velocityY)) * 0.4)
  const distanceThreshold = Math.max(
    48,
    Math.max(Math.abs(displacementX), Math.abs(displacementY)) * 0.4,
  )
  function direction(position: number, extent: number, velocity: number, displacement: number) {
    // Keep deliberate movement intent even when the pointer slows before release.
    if (Math.abs(displacement) >= distanceThreshold) return displacement > 0
    if (Math.abs(velocity) >= speedThreshold) return velocity > 0
    return position >= extent / 2
  }
  const right = direction(x, width, velocityX, displacementX)
  const bottom = direction(y, height, velocityY, displacementY)
  return `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`
}
