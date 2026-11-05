'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { PayloadCMSDocument } from '../../types.js'

import { VisualEditorToolbar } from '../toolbar/index.js'
import styles from './styles.module.scss'

export type WorkspaceSource = {
  global?: boolean
  label: string
  /** No preview resolver means entries open in the native admin in another tab. */
  previewURL?: (document: Record<string, unknown>) => string | undefined
  slug: string
  titleField?: string
}
type Entry = { id: string; label: string; url?: string }
type Mode = 'annotate' | 'browse' | 'edit'
const frameName = 'oak-visual-editor-canvas'

function isCanvas() {
  try {
    return (
      window.frameElement?.getAttribute('name') === frameName ||
      new URLSearchParams(window.location.search).get('visual-editor-canvas') === '1'
    )
  } catch {
    return false
  }
}

export function VisualEditorWorkspace({
  adminRoute = '/admin',
  apiRoute = '/api',
  documentInfo,
  sources,
}: {
  adminRoute?: string
  apiRoute?: string
  documentInfo: PayloadCMSDocument
  sources: WorkspaceSource[]
}) {
  const [canvas] = useState(isCanvas)
  if (canvas) {
    return (
      <WorkspaceCanvas adminRoute={adminRoute} apiRoute={apiRoute} documentInfo={documentInfo} />
    )
  }
  return (
    <WorkspaceShell
      adminRoute={adminRoute}
      apiRoute={apiRoute}
      documentInfo={documentInfo}
      sources={sources}
    />
  )
}

function WorkspaceCanvas({
  adminRoute,
  apiRoute,
  documentInfo,
}: {
  adminRoute: string
  apiRoute: string
  documentInfo: PayloadCMSDocument
}) {
  const [containers] = useState(() => {
    if (window.parent === window) {
      return undefined
    }
    try {
      const panelContainer = window.parent.document.getElementById('visual-editor-panel')
      const actionsContainer = window.parent.document.getElementById('visual-editor-actions')
      return panelContainer && actionsContainer ? { actionsContainer, panelContainer } : undefined
    } catch {
      return undefined
    }
  })
  useEffect(() => {
    if (!containers) {
      return
    }
    window.parent.postMessage(
      { type: 'visual-editor:document', documentInfo },
      window.location.origin,
    )
    let mode = 'edit'
    const receive = (event: MessageEvent) => {
      if (
        event.source === window.parent &&
        event.origin === window.location.origin &&
        event.data?.type === 'visual-editor:set-mode'
      ) {
        mode = event.data.mode
      }
    }
    const follow = (event: MouseEvent) => {
      if (
        mode !== 'browse' ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download')
      ) {
        return
      }
      const url = new URL(link.href)
      if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) {
        return
      }
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search &&
        url.hash
      ) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      window.parent.postMessage(
        { type: 'visual-editor:navigate', label: link.textContent || 'Page', url: url.href },
        window.location.origin,
      )
    }
    window.addEventListener('message', receive)
    document.addEventListener('click', follow, true)
    const clear = () => {
      containers.panelContainer.replaceChildren()
      containers.actionsContainer.replaceChildren()
    }
    window.addEventListener('pagehide', clear)
    return () => {
      window.removeEventListener('pagehide', clear)
      window.removeEventListener('message', receive)
      document.removeEventListener('click', follow, true)
    }
  }, [containers, documentInfo])
  const workspace = useMemo(
    () =>
      containers
        ? {
            ...containers,
            onModeChange: (mode: Mode) =>
              window.parent.postMessage(
                { type: 'visual-editor:mode', mode },
                window.location.origin,
              ),
            onPendingChange: (pending: boolean, busy: boolean) =>
              window.parent.postMessage(
                { type: 'visual-editor:pending', busy, pending },
                window.location.origin,
              ),
          }
        : undefined,
    [containers],
  )
  return (
    <VisualEditorToolbar
      adminRoute={adminRoute}
      apiRoute={apiRoute}
      documentInfo={documentInfo}
      key={`${documentInfo.collection}:${documentInfo.id}:${documentInfo.locale}`}
      workspace={workspace}
    />
  )
}

function WorkspaceShell({
  adminRoute,
  apiRoute,
  documentInfo,
  sources,
}: {
  adminRoute: string
  apiRoute: string
  documentInfo: PayloadCMSDocument
  sources: WorkspaceSource[]
}) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const [src, setSrc] = useState(() => {
    const url = new URL(window.location.href)
    url.searchParams.set('visual-editor-canvas', '1')
    return url.href
  })
  const [current, setCurrent] = useState(documentInfo)
  const [currentLabel, setCurrentLabel] = useState('Current page')
  const [sourceSlug, setSourceSlug] = useState(documentInfo.collection)
  const source = sources.find((item) => item.slug === sourceSlug) ?? sources[0]
  const [entries, setEntries] = useState<Entry[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<Mode>('edit')
  const [viewport, setViewport] = useState('desktop')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [navigation, setNavigation] = useState<Entry>()
  const [ready, setReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  const navigate = useCallback(
    (entry: Entry) => {
      if (!entry.url) {
        return
      }
      if (entry.id === current.id) {
        setPickerOpen(false)
        setNavigation(undefined)
        return
      }
      const url = new URL(entry.url, window.location.origin)
      if (url.origin !== window.location.origin) {
        setError('Preview must be on this site.')
        return
      }
      url.searchParams.set('visual-editor-canvas', '1')
      setPending(false)
      setBusy(false)
      setReady(false)
      setLoadFailed(false)
      setMode('edit')
      setSrc(url.href)
      setPickerOpen(false)
      setNavigation(undefined)
    },
    [current.id],
  )

  useEffect(() => {
    if (navigation) {
      dialog.current?.showModal()
    }
  }, [navigation])

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ depth: '0', draft: 'true' })
    if (current.locale) {
      query.set('locale', current.locale)
    }
    void fetch(
      `${apiRoute}/${encodeURIComponent(current.collection)}/${encodeURIComponent(current.id)}?${query}`,
      { credentials: 'same-origin', signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          return
        }
        const doc = await response.json()
        if (!controller.signal.aborted) {
          setCurrentLabel(String(doc.name || doc.title || doc.slug || 'Current page'))
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [apiRoute, current.collection, current.id, current.locale])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const siblings = Array.from(document.body.children).filter(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element !== root.current &&
        !['LINK', 'SCRIPT', 'STYLE'].includes(element.tagName),
    )
    const originals = siblings.map((element) => element.inert)
    siblings.forEach((element) => {
      element.inert = true
    })
    return () => {
      document.body.style.overflow = previous
      siblings.forEach((element, index) => {
        element.inert = originals[index]
      })
    }
  }, [])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframe.current?.contentWindow
      ) {
        return
      }
      if (event.data?.type === 'visual-editor:navigate' && typeof event.data.url === 'string') {
        if (busy) {
          return
        }
        const entry = { id: '', label: String(event.data.label), url: event.data.url }
        if (pending) {
          setNavigation(entry)
        } else {
          navigate(entry)
        }
      }
      if (event.data?.type === 'visual-editor:pending') {
        setPending(Boolean(event.data.pending))
        setBusy(Boolean(event.data.busy))
      }
      if (
        event.data?.type === 'visual-editor:mode' &&
        ['annotate', 'browse', 'edit'].includes(event.data.mode)
      ) {
        setMode(event.data.mode)
      }
      if (event.data?.type === 'visual-editor:document') {
        setCurrent(event.data.documentInfo)
        setReady(true)
        setLoadFailed(false)
      }
    }
    window.addEventListener('message', receive)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending || busy) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('message', receive)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [pending, busy, navigate])

  useEffect(() => {
    if (ready) {
      return
    }
    const timer = setTimeout(() => setLoadFailed(true), 20000)
    return () => clearTimeout(timer)
  }, [ready, src])

  useEffect(() => {
    if (!pickerOpen || !source || source.global) {
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({
          depth: '0',
          draft: 'true',
          limit: '20',
          page: String(page),
          sort: source.titleField ?? 'title',
        })
        if (documentInfo.locale) {
          query.set('locale', documentInfo.locale)
        }
        if (search.trim()) {
          query.set(`where[${source.titleField ?? 'title'}][like]`, search.trim())
        }
        const response = await fetch(`${apiRoute}/${encodeURIComponent(source.slug)}?${query}`, {
          credentials: 'same-origin',
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error('Unable to load content. Check your access and try again.')
        }
        const result = await response.json()
        if (!Array.isArray(result.docs)) {
          throw new Error('Unable to load content.')
        }
        setEntries(
          result.docs.map((doc: Record<string, unknown>) => ({
            id: String(doc.id),
            label: String(doc[source.titleField ?? 'title'] || doc.name || doc.slug || doc.id),
            url: source.previewURL?.(doc),
          })),
        )
        setHasNext(Boolean(result.hasNextPage))
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Unable to load content.')
          setEntries([])
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [source, search, page, pickerOpen, apiRoute, documentInfo.locale])

  function changeMode(next: Mode) {
    setMode(next)
    iframe.current?.contentWindow?.postMessage(
      { type: 'visual-editor:set-mode', mode: next },
      window.location.origin,
    )
  }
  const adminURL = `${adminRoute}/collections/${encodeURIComponent(current.collection)}/${encodeURIComponent(current.id)}`
  const activeLabel = sourceSlug === current.collection ? currentLabel : 'Choose content'
  return createPortal(
    <div className={styles.workspace} data-mode={mode} data-visual-editor-workspace ref={root}>
      <header className={styles.header}>
        <div className={styles.navigation}>
          <select
            aria-label="Content source"
            onChange={(event) => {
              setSourceSlug(event.target.value)
              setSearch('')
              setPage(1)
              setEntries([])
              setPickerOpen(true)
            }}
            value={sourceSlug}
          >
            {sources.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            aria-controls="visual-editor-navigation"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen(!pickerOpen)}
            type="button"
          >
            {activeLabel || 'Choose content'} <span aria-hidden>⌄</span>
          </button>
          {pickerOpen && (
            <section
              aria-label="Content navigation"
              className={styles.picker}
              id="visual-editor-navigation"
              role="dialog"
            >
              <div className={styles.pickerHeading}>
                <strong>{source?.label}</strong>
                <button
                  aria-label="Close content navigation"
                  onClick={() => setPickerOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              {source?.global ? (
                <a href={`${adminRoute}/globals/${source.slug}`} rel="noreferrer" target="_blank">
                  Open {source.label} in Payload ↗
                </a>
              ) : (
                <>
                  <input
                    aria-label="Search content"
                    onChange={(event) => {
                      setSearch(event.target.value)
                      setPage(1)
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        setPickerOpen(false)
                      }
                    }}
                    placeholder="Search content…"
                    value={search}
                  />
                  {loading ? (
                    <p role="status">Loading content…</p>
                  ) : (
                    <ul>
                      {entries.map((entry) => (
                        <li key={entry.id}>
                          {entry.url ? (
                            <button
                              aria-current={current.id === entry.id ? 'page' : undefined}
                              disabled={busy}
                              onClick={() => (pending ? setNavigation(entry) : navigate(entry))}
                              type="button"
                            >
                              {entry.label}
                            </button>
                          ) : (
                            <a
                              href={`${adminRoute}/collections/${source?.slug}/${encodeURIComponent(entry.id)}`}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {entry.label} ↗
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {!loading && !error && entries.length === 0 && <p>No matching content.</p>}
                  {error && <p role="alert">{error}</p>}
                  <div className={styles.pagination}>
                    <button
                      disabled={page === 1 || loading}
                      onClick={() => setPage(page - 1)}
                      type="button"
                    >
                      Previous
                    </button>
                    <span>Page {page}</span>
                    <button
                      disabled={!hasNext || loading}
                      onClick={() => setPage(page + 1)}
                      type="button"
                    >
                      Next
                    </button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
        <span className={styles.draft}>DRAFT PREVIEW</span>
        <nav aria-label="Editor tools" className={styles.tools}>
          <button
            aria-pressed={mode === 'browse'}
            onClick={() => changeMode('browse')}
            type="button"
          >
            Browse
          </button>
          <button aria-pressed={mode === 'edit'} onClick={() => changeMode('edit')} type="button">
            Edit content
          </button>
          <button
            aria-pressed={mode === 'annotate'}
            onClick={() => changeMode('annotate')}
            type="button"
          >
            Annotate
          </button>
        </nav>
        <div aria-label="Preview width" className={styles.viewports}>
          <button
            aria-label="Desktop preview"
            aria-pressed={viewport === 'desktop'}
            onClick={() => setViewport('desktop')}
            title="Desktop preview"
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="20"
              stroke="currentColor"
              strokeWidth="1.7"
              viewBox="0 0 24 24"
              width="20"
            >
              <rect height="13" rx="1.5" width="18" x="3" y="3" />
              <path d="M12 16v5M7 21h10" />
            </svg>
          </button>
          <button
            aria-label="Mobile preview"
            aria-pressed={viewport === 'mobile'}
            onClick={() => setViewport('mobile')}
            title="Mobile preview"
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="20"
              stroke="currentColor"
              strokeWidth="1.7"
              viewBox="0 0 24 24"
              width="20"
            >
              <rect height="20" rx="2" width="12" x="6" y="2" />
              <path d="M10 19h4" />
            </svg>
          </button>
        </div>
        <button
          disabled={!ready}
          onClick={() => {
            changeMode('edit')
            iframe.current?.contentWindow?.postMessage(
              { type: 'visual-editor:show-revisions' },
              window.location.origin,
            )
          }}
          type="button"
        >
          Revisions
        </button>
        <div className={styles.actions} id="visual-editor-actions" key={`actions:${src}`} />
      </header>
      <div className={styles.body}>
        <main className={styles.stage}>
          <div className={styles.canvas} data-viewport={viewport}>
            {/* Trusted same-origin preview: the editor portals controls into this document. */}
            {/* eslint-disable-next-line @eslint-react/dom/no-missing-iframe-sandbox */}
            <iframe key={src} name={frameName} ref={iframe} src={src} title="Website preview" />
          </div>
          {!ready && (
            <div className={styles.loading} role="status">
              {loadFailed ? (
                <>
                  The editor could not connect. <a href={adminURL}>Open in Payload</a>
                </>
              ) : (
                'Opening preview…'
              )}
            </div>
          )}
        </main>
        <div
          className={styles.panel}
          hidden={mode !== 'edit'}
          id="visual-editor-panel"
          key={`panel:${src}`}
        />
      </div>
      {navigation && (
        <dialog
          aria-labelledby="navigation-title"
          className={styles.scrim}
          onCancel={() => setNavigation(undefined)}
          ref={dialog}
        >
          <section className={styles.confirm}>
            <h2 id="navigation-title">Unsaved changes</h2>
            <p>Save your draft before switching pages, or discard the pending changes.</p>
            <button onClick={() => setNavigation(undefined)} type="button">
              Keep editing
            </button>
            <button disabled={busy} onClick={() => navigate(navigation)} type="button">
              Discard and switch
            </button>
          </section>
        </dialog>
      )}
    </div>,
    document.body,
  )
}
