'use client'

import { useState } from 'react'

export function AnnotationEditor({
  comment,
  element,
  editing,
  onCancel,
  onSubmit,
}: {
  comment: string
  element: string
  editing: boolean
  onCancel: () => void
  onSubmit: (comment: string) => void
}) {
  const [text, setText] = useState(comment)
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim()) onSubmit(text.trim())
      }}
    >
      <p>{element}</p>
      <label>
        Note
        <textarea
          aria-label="Note"
          autoFocus
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={6}
        />
      </label>
      <nav>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={!text.trim()}>
          {editing ? 'Save note' : 'Add note'}
        </button>
      </nav>
    </form>
  )
}
