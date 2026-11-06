'use client'

import { useEffect, useRef, useState } from 'react'
import type { PayloadCMSDocument } from '../../types.js'
import styles from './styles.module.scss'

export type MediaChoice = {
  id: string | number
  url: string
  thumbnailURL?: string
  filename?: string
  focalX?: number
  focalY?: number
  alt?: string
}
type Results = {
  docs: MediaChoice[]
  page: number
  totalPages: number
  collection: string
  canUpload: boolean
}

export function MediaPicker({
  adminRoute,
  apiRoute,
  documentInfo,
  path,
  onClose,
  onSelect,
  selected,
  onSelectionChange,
  embedded = false,
}: {
  embedded?: boolean
  adminRoute: string
  apiRoute: string
  documentInfo: PayloadCMSDocument
  path: string
  onClose: () => void
  onSelect: (media: MediaChoice) => void
  selected?: MediaChoice
  onSelectionChange?: (media?: MediaChoice) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [results, setResults] = useState<Results>()
  const [localSelection, setLocalSelection] = useState<MediaChoice>()
  const activeSelection = onSelectionChange ? selected : localSelection
  const changeSelection = onSelectionChange ?? setLocalSelection
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  useEffect(() => {
    if (embedded) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.showModal()
    return () => previous?.focus()
  }, [embedded])
  useEffect(() => {
    const controller = new AbortController()
    setBusy(true)
    setError('')
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiRoute}/payload-visual-editor/media`, {
          method: 'POST',
          credentials: 'same-origin',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...documentInfo, path, search, page }),
        })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unable to load images')
        if (!controller.signal.aborted) setResults(data)
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Unable to load images')
      } finally {
        if (!controller.signal.aborted) setBusy(false)
      }
    }, 200)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [
    documentInfo.id,
    documentInfo.collection,
    documentInfo.locale,
    path,
    search,
    page,
    revision,
    apiRoute,
  ])

  const content = (
    <>
      {!embedded && (
        <header>
          <h2 id="ve-media-title">{activeSelection ? 'Image preview' : 'Choose an image'}</h2>
          <button type="button" onClick={onClose} aria-label="Close image picker">
            Close
          </button>
        </header>
      )}
      {activeSelection && !uploading ? (
        <div className={styles.drawerView}>
          <figure className={styles.preview}>
            <img src={activeSelection.url} alt={activeSelection.alt || ''} />
            <figcaption>
              {activeSelection.filename || activeSelection.alt || String(activeSelection.id)}
            </figcaption>
          </figure>
          <footer>
            <button type="button" onClick={() => changeSelection(undefined)}>
              Cancel
            </button>
            <button type="button" onClick={() => onSelect(activeSelection)}>
              Use image
            </button>
          </footer>
        </div>
      ) : uploading ? (
        <section aria-label="Upload an image" className={styles.drawerView}>
          <p>Save the new image in Payload, then return to the image list.</p>
          <iframe
            title="Upload a new image in Payload"
            className={styles.upload}
            src={`${adminRoute}/collections/${encodeURIComponent(results!.collection)}/create${documentInfo.locale ? `?locale=${encodeURIComponent(documentInfo.locale)}` : ''}`}
          />
          <button
            type="button"
            onClick={() => {
              setUploading(false)
              setSearch('')
              setPage(1)
              setRevision((value) => value + 1)
            }}
          >
            Return to images
          </button>
        </section>
      ) : (
        <div className={styles.drawerView}>
          {results?.canUpload && (
            <section aria-label="Upload an image">
              <button type="button" onClick={() => setUploading(true)}>
                Upload a new image
              </button>
            </section>
          )}
          <label>
            Search filenames
            <input
              autoFocus
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setPage(1)
              }}
            />
          </label>
          <p className={styles.status} role="status">
            {busy
              ? 'Loading images…'
              : `Page ${results?.page ?? 1} of ${Math.max(1, results?.totalPages ?? 1)}`}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className={styles.grid} aria-label="Available images" aria-busy={busy}>
            {!busy &&
              results?.docs.map((media) => (
                <button type="button" key={media.id} onClick={() => changeSelection(media)}>
                  <img src={media.thumbnailURL || media.url} alt="" loading="lazy" />
                  <span>{media.filename || media.alt || String(media.id)}</span>
                </button>
              ))}
          </div>
          {!busy && results?.docs.length === 0 && (
            <p>No matching images. Uploaded images must match this field’s restrictions.</p>
          )}
          <nav aria-label="Image pages">
            <button
              type="button"
              disabled={busy || page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={busy || !results || page >= results.totalPages}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </nav>
          <footer>
            <button type="button" onClick={onClose}>
              Cancel
            </button>
          </footer>
        </div>
      )}
    </>
  )
  if (embedded)
    return (
      <section
        className={`${styles.dialog} ${styles.embedded}`}
        aria-label={activeSelection ? 'Image preview' : 'Media library'}
      >
        {content}
      </section>
    )
  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="ve-media-title"
      data-feedback-toolbar
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          if (activeSelection) changeSelection(undefined)
          else onClose()
        }
      }}
      onCancel={(event) => {
        event.preventDefault()
        if (activeSelection) changeSelection(undefined)
        else onClose()
      }}
    >
      {content}
    </dialog>
  )
}
