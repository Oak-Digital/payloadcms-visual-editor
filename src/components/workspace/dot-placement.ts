export type DotPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export function resolveDotPosition(
  x: number,
  y: number,
  velocityX: number,
  velocityY: number,
  width: number,
  height: number,
): DotPosition {
  // A deliberate flick chooses its direction regardless of distance to the midpoint.
  const threshold = Math.max(0.25, Math.max(Math.abs(velocityX), Math.abs(velocityY)) * 0.4)
  const right = Math.abs(velocityX) >= threshold ? velocityX > 0 : x >= width / 2
  const bottom = Math.abs(velocityY) >= threshold ? velocityY > 0 : y >= height / 2
  return `${bottom ? 'bottom' : 'top'}-${right ? 'right' : 'left'}`
}
