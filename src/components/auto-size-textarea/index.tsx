'use client'

import { type ComponentPropsWithoutRef, useLayoutEffect, useRef } from 'react'

function resize(textarea: HTMLTextAreaElement) {
  textarea.style.height = 'auto'
  if (!textarea.clientWidth) return
  const border = textarea.offsetHeight - textarea.clientHeight
  textarea.style.height = `${textarea.scrollHeight + border}px`
}

export function AutoSizeTextarea(props: Omit<ComponentPropsWithoutRef<'textarea'>, 'rows'>) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    if (ref.current) resize(ref.current)
  }, [props.value])

  useLayoutEffect(() => {
    const textarea = ref.current
    if (!textarea) return
    const Observer = textarea.ownerDocument.defaultView?.ResizeObserver
    if (!Observer) return
    let width = textarea.clientWidth
    const observer = new Observer(() => {
      if (textarea.clientWidth === width) return
      width = textarea.clientWidth
      resize(textarea)
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [])

  return <textarea {...props} ref={ref} rows={3} />
}
