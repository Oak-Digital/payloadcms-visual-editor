'use client'

import { RenderLexical } from '@payloadcms/richtext-lexical/client'
import type { DefaultTypedEditorState } from '@payloadcms/richtext-lexical'
import { useEffect, useState } from 'react'
import { useConfig } from '@payloadcms/ui'
import styles from './styles.module.scss'

type Snapshot = { value: DefaultTypedEditorState; revision: string; schemaPath: string }

/** Runs inside the host admin providers, so field features and drawers are unchanged. */
export function RichTextEditorView() {
  const { config } = useConfig()
  const apiRoute = config.routes.api
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [value, setValue] = useState<DefaultTypedEditorState>()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Loading editor…')
  const [busy, setBusy] = useState(false)
  const [parameters, setParameters] = useState<Record<string, string>>()

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    const params = Object.fromEntries(
      ['collection', 'id', 'locale', 'path'].map((key) => [key, query.get(key) || '']),
    )
    setParameters(params)
    const controller = new AbortController()
    void fetch(`${apiRoute}/payload-visual-editor/rich-text`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, action: 'read' }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) throw new Error(result.error)
        setSnapshot(result)
        setValue(result.value)
        setStatus('')
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(String(reason.message))
          setStatus('')
        }
      })
    return () => controller.abort()
  }, [apiRoute])

  async function submit(action: 'save' | 'publish') {
    if (!snapshot || !value || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${apiRoute}/payload-visual-editor/rich-text`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parameters, action, value, revision: snapshot.revision }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      setStatus(action === 'save' ? 'Draft saved.' : 'Published.')
      window.parent.postMessage({ type: 'payload-visual-editor:saved' }, window.location.origin)
      // Fetch a new revision before allowing a subsequent publish.
      const refreshed = await fetch(`${apiRoute}/payload-visual-editor/rich-text`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parameters, action: 'read' }),
      })
      const next = await refreshed.json()
      if (!refreshed.ok) throw new Error(next.error)
      setSnapshot(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={styles.editor}>
      <h1>Edit rich text</h1>
      {error && <p role="alert">{error}</p>}
      <p role="status">{status}</p>
      {snapshot && value && (
        <RenderLexical
          key={snapshot.schemaPath}
          initialValue={snapshot.value}
          value={value}
          setValue={(next) => {
            setValue(next as DefaultTypedEditorState)
            window.parent.postMessage(
              { type: 'payload-visual-editor:changed' },
              window.location.origin,
            )
          }}
          path={parameters?.path}
          schemaPath={snapshot.schemaPath}
        />
      )}
      <div className={styles.actions}>
        <button type="button" disabled={!snapshot || busy} onClick={() => void submit('save')}>
          Save draft
        </button>
        <button type="button" disabled={!snapshot || busy} onClick={() => void submit('publish')}>
          Publish
        </button>
      </div>
    </main>
  )
}
