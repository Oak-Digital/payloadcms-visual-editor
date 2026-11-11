import { type RefObject, useEffect, useRef, useState } from 'react'

export const STATUS_IDLE_DELAY = 5000

export function useStatusCollapse({
  active,
  blocked,
  status,
  preview,
}: {
  active: boolean
  blocked: boolean
  status: string
  preview: RefObject<HTMLIFrameElement | null>
}) {
  const [collapsed, setCollapsed] = useState(false)
  const footer = useRef<HTMLElement>(null)

  useEffect(() => {
    setCollapsed(false)
  }, [status, blocked, active])

  useEffect(() => {
    if (!active || blocked || collapsed) return
    const element = footer.current
    const frame = preview.current
    let timer: ReturnType<typeof setTimeout>
    let hovered = element?.matches(':hover') ?? false
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (hovered || element?.contains(element.ownerDocument.activeElement)) return
        setCollapsed(true)
      }, STATUS_IDLE_DELAY)
    }
    const enter = () => {
      hovered = true
      clearTimeout(timer)
    }
    const leave = () => {
      hovered = false
      reset()
    }
    const events = ['pointerdown', 'keydown', 'input', 'focusin', 'focusout', 'wheel'] as const
    const listen = (doc: Document | null | undefined, add: boolean) => {
      for (const event of events) {
        if (add) doc?.addEventListener(event, reset, { capture: true, passive: true })
        else doc?.removeEventListener(event, reset, true)
      }
    }
    let canvas: Document | null | undefined
    const loaded = () => {
      listen(canvas, false)
      canvas = frame?.contentDocument
      listen(canvas, true)
      reset()
    }
    listen(document, true)
    loaded()
    frame?.addEventListener('load', loaded)
    element?.addEventListener('pointerenter', enter)
    element?.addEventListener('pointerleave', leave)
    return () => {
      clearTimeout(timer)
      listen(document, false)
      listen(canvas, false)
      frame?.removeEventListener('load', loaded)
      element?.removeEventListener('pointerenter', enter)
      element?.removeEventListener('pointerleave', leave)
    }
  }, [active, blocked, collapsed, status, preview])

  return {
    collapsed: collapsed && !blocked,
    footer,
    toggle: () => {
      if (blocked) return
      setCollapsed((value) => !value)
    },
  }
}
