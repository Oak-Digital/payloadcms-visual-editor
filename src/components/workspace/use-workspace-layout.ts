import { useCallback, useEffect, useState } from 'react'

type WorkspaceLayout = { layout: 'floating' | 'sidebar'; framed: boolean }
const storageKey = 'oak-visual-editor:workspace-layout'
const defaults: WorkspaceLayout = { layout: 'floating', framed: false }

export function useWorkspaceLayout() {
  const [settings, setSettings] = useState(defaults)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
      if (!saved || typeof saved !== 'object') return
      setSettings({
        layout: saved.layout === 'sidebar' ? 'sidebar' : 'floating',
        framed: saved.framed === true,
      })
    } catch {
      // Layout controls remain available when storage is blocked or invalid.
    }
  }, [])

  const update = useCallback((patch: Partial<WorkspaceLayout>) => {
    setSettings((current) => ({ ...current, ...patch }))
  }, [])

  // Wait until preferences have loaded before persisting changes.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => setLoaded(true), [])
  useEffect(() => {
    if (!loaded) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(settings))
    } catch {
      // Keep the selected layout for this workspace session.
    }
  }, [loaded, settings])

  return [settings, update] as const
}
