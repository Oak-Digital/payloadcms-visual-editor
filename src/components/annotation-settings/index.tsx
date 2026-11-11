'use client'

import { useConfig, useField } from '@payloadcms/ui'
import { useRef, useState } from 'react'
import styles from './styles.module.scss'

type Option = { id: string; name: string }
export function AnnotationSettingsField() {
  const { config } = useConfig()
  const key = useField<string>({ path: 'apiKeyInput' })
  const clear = useField<boolean>({ path: 'clearApiKey' })
  const configured = useField<boolean>({ path: 'apiKeyConfigured' })
  const project = useField<string>({ path: 'projectId' })
  const label = useField<string>({ path: 'bugLabelId' })
  const [options, setOptions] = useState<{ projects: Option[]; labels: Option[] }>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(false)
  const requestVersion = useRef(0)
  const invalidate = () => {
    requestVersion.current++
    setOptions(undefined)
    setMessage('')
    setBusy(false)
  }
  async function testConnection() {
    const version = ++requestVersion.current
    setBusy(true)
    setMessage('')
    try {
      const response = await fetch(`${config.routes.api}/payload-visual-editor/connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key.value || '' }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Connection failed. Try again.')
      if (version !== requestVersion.current) return
      setOptions(result)
      if (!project.value && result.projects.length === 1) project.setValue(result.projects[0].id)
      if (!label.value) {
        const bug = result.labels.find((item: Option) => item.name.toLowerCase() === 'bug')
        if (bug) label.setValue(bug.id)
      }
      setError(false)
      setMessage('Connected. Select the project and label, then save.')
    } catch (cause) {
      if (version !== requestVersion.current) return
      setError(true)
      setMessage(cause instanceof Error ? cause.message : 'Connection failed. Try again.')
    } finally {
      if (version === requestVersion.current) setBusy(false)
    }
  }
  return (
    <section className={styles.connection} aria-label="Oak OS connection">
      <h3>Oak OS annotations</h3>
      <label htmlFor="oak-api-key">API key</label>
      <input
        id="oak-api-key"
        type="password"
        autoComplete="new-password"
        maxLength={500}
        value={key.value || ''}
        placeholder={
          configured.value && !clear.value
            ? 'Saved key · enter a new key to replace'
            : 'Enter project API key'
        }
        onChange={(event) => {
          key.setValue(event.target.value)
          clear.setValue(false)
          invalidate()
        }}
      />
      {configured.value && (
        <label className={styles.clear}>
          <input
            type="checkbox"
            checked={Boolean(clear.value)}
            onChange={(event) => {
              clear.setValue(event.target.checked)
              key.setValue('')
              invalidate()
            }}
          />
          Remove saved key on save
        </label>
      )}
      <button
        type="button"
        disabled={busy || clear.value || (!key.value && !configured.value)}
        onClick={() => void testConnection()}
      >
        {busy ? 'Connecting…' : 'Test connection'}
      </button>
      {message && <p role={error ? 'alert' : 'status'}>{message}</p>}
      <div className={styles.selectors}>
        <div>
          <label htmlFor="oak-project">Project</label>
          <select
            id="oak-project"
            value={project.value || ''}
            onChange={(event) => project.setValue(event.target.value)}
          >
            <option value="">Select project</option>
            {project.value && !options?.projects.some((item) => item.id === project.value) && (
              <option value={project.value}>Saved project · test connection to load</option>
            )}
            {options?.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="oak-label">Bug label</label>
          <select
            id="oak-label"
            value={label.value || ''}
            onChange={(event) => label.setValue(event.target.value)}
          >
            <option value="">Select label</option>
            {label.value && !options?.labels.some((item) => item.id === label.value) && (
              <option value={label.value}>Saved label · test connection to load</option>
            )}
            {options?.labels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}
