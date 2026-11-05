'use client'

import { useEffect, useState } from 'react'

import type { PayloadCMSDocument } from '../../types.js'

import { revisionChanges } from '../../utils/revisions.js'
import styles from './styles.module.scss'

type Revision = {
  id: string
  updatedAt: string
  version: Record<string, unknown>
}

export function RevisionHistory({
  apiRoute,
  owner,
  refresh,
}: {
  apiRoute: string
  owner: PayloadCMSDocument
  refresh: number
}) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [limit, setLimit] = useState(10)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const query = new URLSearchParams({
      depth: '0',
      limit: String(limit + 1),
      sort: '-updatedAt',
      'where[parent][equals]': String(owner.id),
    })
    if (owner.locale) {
      query.set('locale', owner.locale)
    }
    void (async () => {
      try {
        const response = await fetch(
          `${apiRoute}/${encodeURIComponent(owner.collection)}/versions?${query}`,
          {
            credentials: 'same-origin',
            signal: controller.signal,
          },
        )
        if (!response.ok) {
          throw new Error('Unable to load revisions. Check your access and try again.')
        }
        const result = await response.json()
        if (!Array.isArray(result.docs)) {
          throw new Error('Unable to load revisions.')
        }
        if (controller.signal.aborted) {
          return
        }
        setRevisions(result.docs)
        setHasMore(result.docs.length > limit)
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : 'Unable to load revisions.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    })()
    return () => controller.abort()
  }, [apiRoute, owner.collection, owner.id, owner.locale, limit, refresh, retry])

  return (
    <section aria-label="Saved revisions" className={styles.history}>
      <h3>Saved revisions</h3>
      <p>History for this page.</p>
      {loading && <p role="status">Loading revisions…</p>}
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button onClick={() => setRetry((value) => value + 1)} type="button">
            Try again
          </button>
        </>
      ) : (
        <>
          {!loading && revisions.length === 0 && <p>No saved revisions yet.</p>}
          <ol>
            {revisions.slice(0, limit).map((revision, index) => {
              const previous = revisions[index + 1]
              const changes = previous ? revisionChanges(previous.version, revision.version) : []
              return (
                <li key={revision.id}>
                  <time dateTime={revision.updatedAt}>
                    {new Date(revision.updatedAt).toLocaleString()}
                  </time>
                  <p>
                    {index === 0
                      ? revision.version._status === 'published'
                        ? 'Current published version'
                        : 'Current draft'
                      : revision.version._status === 'published'
                        ? 'Published'
                        : 'Draft'}
                  </p>
                  {previous ? (
                    <details>
                      <summary>View changes · {changes.length}</summary>
                      {changes.length === 0 && <p>No content changes.</p>}
                      {changes.map((change) => (
                        <div className={styles.change} key={change.path}>
                          <strong>{change.path}</strong>
                          <small>Before</small>
                          <pre>{displayValue(change.before)}</pre>
                          <small>After</small>
                          <pre>{displayValue(change.after)}</pre>
                        </div>
                      ))}
                    </details>
                  ) : (
                    <p>First available revision.</p>
                  )}
                </li>
              )
            })}
          </ol>
          {hasMore && (
            <button
              disabled={loading}
              onClick={() => setLimit((value) => value + 10)}
              type="button"
            >
              Load older revisions
            </button>
          )}
        </>
      )}
      <p>Saving creates a new revision.</p>
    </section>
  )
}

function displayValue(value: unknown) {
  if (value === undefined || value === null) {
    return 'Empty'
  }
  return typeof value === 'string' ? value || 'Empty' : JSON.stringify(value, null, 2)
}
