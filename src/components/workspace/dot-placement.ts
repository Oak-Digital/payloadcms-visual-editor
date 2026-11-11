export type DotPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export function resolveDotPosition(
  x: number,
  y: number,
  velocityX: number,
  velocityY: number,
  width: number,
  height: number,
): DotPosition {
  // Project a short coast so a flick can reach a corner before crossing the midpoint.
  const projectedX = x + velocityX * 240
  const projectedY = y + velocityY * 240
  return `${projectedY < height / 2 ? 'top' : 'bottom'}-${projectedX < width / 2 ? 'left' : 'right'}`
}
