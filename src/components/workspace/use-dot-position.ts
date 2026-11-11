import { useCallback, useEffect, useState } from 'react'
import type { DotPosition } from './dot-placement.js'

const storageKey = 'oak-visual-editor:dot-position'

export function useDotPosition() {
  const [position, setPosition] = useState<DotPosition>('top-right')

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (
        saved === 'top-left' ||
        saved === 'top-right' ||
        saved === 'bottom-left' ||
        saved === 'bottom-right'
      )
        setPosition(saved)
    } catch {
      // Placement still works when browser storage is unavailable.
    }
  }, [])

  const update = useCallback((next: DotPosition) => {
    setPosition(next)
    try {
      localStorage.setItem(storageKey, next)
    } catch {
      // Keep the chosen corner for this workspace session.
    }
  }, [])

  return [position, update] as const
}
