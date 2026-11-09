'use client'

import { useEffect, useState } from 'react'

import type { PayloadCMSDocument } from '../../types.js'

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
  onPreview,
  onReturn,
  onRestore,
  canRestore = false,
}: {
  apiRoute: string
  owner: PayloadCMSDocument
  refresh: number
  onPreview?: (owner: PayloadCMSDocument, versionId: string) => Promise<string>
  onReturn?: (owner: PayloadCMSDocument) => void
  onRestore?: (owner: PayloadCMSDocument, versionId: string, revision: string) => Promise<void>
  canRestore?: boolean
}) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [limit, setLimit] = useState(10)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  const [selected, setSelected] = useState<{ version: Revision; revision: string }>()
  const [working, setWorking] = useState(false)
  useEffect(() => () => onReturn?.(owner), [owner.collection, owner.id, owner.locale, onReturn])
  async function preview(version: Revision) {
    if (!onPreview || working) return
    setWorking(true)
    setError('')
    try {
      const revision = await onPreview(owner, version.id)
      setSelected({ version, revision })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to preview revision')
      setSelected(undefined)
    } finally {
      setWorking(false)
    }
  }
  async function restore() {
    if (!selected || !onRestore || working || !canRestore) return
    setWorking(true)
    setError('')
    try {
      await onRestore(owner, selected.version.id, selected.revision)
      setSelected(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to restore revision')
    } finally {
      setWorking(false)
    }
  }

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
      {working && <p role="status">Updating revision preview…</p>}
      {selected && (
        <section aria-label="Revision preview">
          <p>Previewing {new Date(selected.version.updatedAt).toLocaleString()}</p>
          <p>Linked content uses current saved values.</p>
          <button
            type="button"
            disabled={working}
            onClick={() => {
              onReturn?.(owner)
              setSelected(undefined)
              setError('')
            }}
          >
            Return to current edits
          </button>
          <button type="button" disabled={working || !canRestore} onClick={restore}>
            Restore as draft
          </button>
          {!canRestore && <p>Save or discard pending edits before restoring.</p>}
        </section>
      )}
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
              return (
                <li key={revision.id} data-version-id={revision.id}>
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
                  {onPreview && (
                    <button type="button" disabled={working} onClick={() => preview(revision)}>
                      Preview revision
                    </button>
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
