'use client'

import type { DefaultTypedEditorState } from '@payloadcms/richtext-lexical'

import { RenderLexical } from '@payloadcms/richtext-lexical/client'
import { useConfig } from '@payloadcms/ui'
import { useEffect, useState } from 'react'

import styles from './styles.module.scss'

type Snapshot = { revision: string; schemaPath: string; value: DefaultTypedEditorState }

/** Runs inside the host admin providers, so field features and drawers are unchanged. */
export function RichTextEditorView() {
  const { config } = useConfig()
  const apiRoute = config.routes.api
  const [staging, setStaging] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot>()
  const [value, setValue] = useState<DefaultTypedEditorState>()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Loading editor…')
  const [busy, setBusy] = useState(false)
  const [parameters, setParameters] = useState<Record<string, string>>()

  useEffect(() => {
    const query = new URLSearchParams(window.location.search)
    setStaging(query.get('mode') === 'stage')
    const params = Object.fromEntries(
      ['collection', 'id', 'locale', 'path'].map((key) => [key, query.get(key) || '']),
    )
    setParameters(params)
    const controller = new AbortController()
    void fetch(`${apiRoute}/payload-visual-editor/rich-text`, {
      body: JSON.stringify({ ...params, action: 'read' }),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = await response.json()
        if (!response.ok) {
          throw new Error(result.error)
        }
        setSnapshot(result)
        setValue(result.value)
        setStatus('')
        if (query.get('mode') === 'stage') {
          window.parent.postMessage({ type: 'payload-visual-editor:ready' }, window.location.origin)
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(String(reason.message))
          setStatus('')
        }
      })
    return () => controller.abort()
  }, [apiRoute])

  useEffect(() => {
    if (!staging) {
      return
    }
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        event.data?.type !== 'payload-visual-editor:initial'
      ) {
        return
      }
      setValue(event.data.value)
      setSnapshot((previous) => (previous ? { ...previous, value: event.data.value } : previous))
      setEditorKey((previous) => previous + 1)
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [staging])

  async function submit(action: 'publish' | 'save') {
    if (!snapshot || !value || busy) {
      return
    }
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${apiRoute}/payload-visual-editor/rich-text`, {
        body: JSON.stringify({ ...parameters, action, revision: snapshot.revision, value }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error)
      }
      setStatus(action === 'save' ? 'Draft saved.' : 'Published.')
      window.parent.postMessage({ type: 'payload-visual-editor:saved' }, window.location.origin)
      // Fetch a new revision before allowing a subsequent publish.
      const refreshed = await fetch(`${apiRoute}/payload-visual-editor/rich-text`, {
        body: JSON.stringify({ ...parameters, action: 'read' }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const next = await refreshed.json()
      if (!refreshed.ok) {
        throw new Error(next.error)
      }
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
          initialValue={snapshot.value}
          key={`${snapshot.schemaPath}:${editorKey}`}
          path={parameters?.path}
          schemaPath={snapshot.schemaPath}
          setValue={(next) => {
            setValue(next as DefaultTypedEditorState)
            window.parent.postMessage(
              { type: 'payload-visual-editor:changed' },
              window.location.origin,
            )
          }}
          value={value}
        />
      )}
      <div className={styles.actions}>
        {staging ? (
          <button
            disabled={!snapshot || !value}
            onClick={() =>
              window.parent.postMessage(
                { type: 'payload-visual-editor:staged', value },
                window.location.origin,
              )
            }
            type="button"
          >
            Add to changes
          </button>
        ) : (
          <>
            <button disabled={!snapshot || busy} onClick={() => void submit('save')} type="button">
              Save draft
            </button>
            <button
              disabled={!snapshot || busy}
              onClick={() => void submit('publish')}
              type="button"
            >
              Publish
            </button>
          </>
        )}
      </div>
    </main>
  )
}
