'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { PayloadCMSDocument } from '../../types.js'

import { SharedContentEditor } from '../shared-content/index.js'
import type { SharedTarget } from '../../utils/shared-content.js'
import { usePreviewRefresh } from '../../hooks/use-preview-refresh.js'
import { EditorIcon, OakMark } from './icons.js'
import { VisualEditorToolbar } from '../toolbar/index.js'
import styles from './styles.module.scss'

export type WorkspaceSource = {
  global?: boolean
  editable?: boolean
  label: string
  /** Sources without a preview resolver or shared editing open in the native admin. */
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
  const refresh = usePreviewRefresh()
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source === window.parent &&
        event.origin === window.location.origin &&
        event.data?.type === 'visual-editor:refresh-shared'
      )
        void refresh()
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [refresh])
  const [containers] = useState(() => {
    if (window.parent === window) {
      return undefined
    }
    try {
      const panelContainer = window.parent.document.getElementById('visual-editor-panel')
      const actionsContainer = window.parent.document.getElementById('visual-editor-actions')
      const headerContainer = window.parent.document.getElementById('visual-editor-heading')
      const annotationContainer = window.parent.document.getElementById('visual-editor-annotations')
      const historyContainer = window.parent.document.getElementById(
        'visual-editor-history-actions',
      )
      return panelContainer &&
        actionsContainer &&
        headerContainer &&
        annotationContainer &&
        historyContainer
        ? {
            actionsContainer,
            panelContainer,
            headerContainer,
            annotationContainer,
            historyContainer,
          }
        : undefined
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
      containers.headerContainer.replaceChildren()
      containers.annotationContainer.replaceChildren()
      containers.historyContainer.replaceChildren()
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
            onPendingChange: (
              pending: boolean,
              busy: boolean,
              count: number,
              status: string,
              blocks: number,
            ) =>
              window.parent.postMessage(
                { type: 'visual-editor:pending', busy, pending, count, status, blocks },
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
  const [sharedTarget, setSharedTarget] = useState<SharedTarget>()
  const [sharedVisible, setSharedVisible] = useState(false)
  const [sharedTrail, setSharedTrail] = useState<SharedTarget[]>([])
  const sharedPreviews = useRef(
    new Map<string, { target: SharedTarget; document: Record<string, any>; focusPath?: string }>(),
  )
  const openShared = (target: SharedTarget) => {
    setSharedTrail((trail) => (sharedVisible && sharedTarget ? [...trail, sharedTarget] : []))
    setSharedTarget(target)
    setSharedVisible(true)
  }
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
  const [pagePending, setPending] = useState(false)
  const [pageBusy, setBusy] = useState(false)
  const [sharedPending, setSharedPending] = useState(false)
  const [sharedBusy, setSharedBusy] = useState(false)
  const [sharedEpoch, setSharedEpoch] = useState(0)
  const pending = pagePending || sharedPending
  const busy = pageBusy || sharedBusy
  const [mode, setMode] = useState<Mode>('edit')
  const [viewport, setViewport] = useState('desktop')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [navigation, setNavigation] = useState<Entry>()
  const [ready, setReady] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<
    'home' | 'content' | 'shared' | 'editor' | 'annotations' | 'settings'
  >('home')
  const [dotPosition, setDotPosition] = useState('top-right')
  const [size, setSize] = useState('standard')
  const [pace, setPace] = useState(620)
  const [reduceMotion, setReduceMotion] = useState(false)
  const [changeCount, setChangeCount] = useState(0)
  const [blockCount, setBlockCount] = useState(0)
  const [annotationCount, setAnnotationCount] = useState(0)
  const [annotationEditing, setAnnotationEditing] = useState(false)
  const [saveStatus, setSaveStatus] = useState('')
  const launcher = useRef<HTMLButtonElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  const send = useCallback((type: string, values: Record<string, unknown> = {}) => {
    iframe.current?.contentWindow?.postMessage({ type, ...values }, window.location.origin)
  }, [])
  useEffect(() => {
    const ready = (event: MessageEvent) => {
      if (
        event.source === iframe.current?.contentWindow &&
        event.origin === window.location.origin &&
        event.data?.type === 'visual-editor:shared-ready'
      )
        for (const value of sharedPreviews.current.values())
          send('visual-editor:shared-preview', value)
    }
    window.addEventListener('message', ready)
    return () => window.removeEventListener('message', ready)
  }, [send])
  const collapse = useCallback(() => {
    setOpen(false)
    launcher.current?.focus({ preventScroll: true })
  }, [])
  const reveal = useCallback(() => setOpen(true), [])
  useEffect(() => {
    if (!open) return
    const next = requestAnimationFrame(() => {
      const title =
        view === 'editor'
          ? document.querySelector<HTMLElement>('#visual-editor-heading h2')
          : heading.current
      if (!iframe.current?.contentDocument?.activeElement?.hasAttribute('data-arrange-inline')) {
        title?.focus({ preventScroll: true })
      }
    })
    return () => cancelAnimationFrame(next)
  }, [open, view])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (dialog.current?.open) return
      const target = event.target as HTMLElement
      const typing = target.closest('input, textarea, select, [contenteditable="true"]')
      if (event.key === 'Escape' && open) {
        event.preventDefault()
        if (view === 'editor') send('visual-editor:back')
        else if (view === 'annotations' && annotationEditing)
          send('visual-editor:cancel-annotation')
        else if (view !== 'home') {
          setView('home')
          setPickerOpen(false)
        } else collapse()
      } else if (
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'e'
      ) {
        event.preventDefault()
        if (open) collapse()
        else reveal()
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [open, view, annotationEditing, send, collapse, reveal, sharedVisible])

  const navigate = useCallback(
    (entry: Entry) => {
      if (!entry.url) {
        return
      }
      if (entry.id === current.id) {
        setView('home')
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
      setSharedVisible(false)
      setSharedTarget(undefined)
      setSharedPending(false)
      setSharedBusy(false)
      setSharedEpoch((e) => e + 1)
      sharedPreviews.current.clear()
      setPending(false)
      setBusy(false)
      setReady(false)
      setLoadFailed(false)
      setMode('edit')
      setChangeCount(0)
      setBlockCount(0)
      setAnnotationCount(0)
      setAnnotationEditing(false)
      setSaveStatus('')
      setSrc(url.href)
      setPickerOpen(false)
      setView('home')
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
    const originals = new Map<Element, { inert: string | null; hidden: string | null }>()
    const isolate = () => {
      for (const element of document.body.children) {
        if (
          element === root.current ||
          ['LINK', 'SCRIPT', 'STYLE'].includes(element.tagName) ||
          originals.has(element)
        )
          continue
        originals.set(element, {
          inert: element.getAttribute('inert'),
          hidden: element.getAttribute('aria-hidden'),
        })
        element.setAttribute('inert', '')
        element.setAttribute('aria-hidden', 'true')
      }
    }
    isolate()
    const observer = new MutationObserver(isolate)
    observer.observe(document.body, { childList: true })
    return () => {
      observer.disconnect()
      document.body.style.overflow = previous
      for (const [element, attributes] of originals) {
        for (const [name, value] of [
          ['inert', attributes.inert],
          ['aria-hidden', attributes.hidden],
        ] as const) {
          if (value === null) element.removeAttribute(name)
          else element.setAttribute(name, value)
        }
      }
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
        setChangeCount(Number(event.data.count) || 0)
        setBlockCount(Number(event.data.blocks) || 0)
        setSaveStatus(String(event.data.status || ''))
      }
      if (
        event.data?.type === 'visual-editor:mode' &&
        ['annotate', 'browse', 'edit'].includes(event.data.mode)
      ) {
        setMode(event.data.mode)
      }
      if (event.data?.type === 'visual-editor:reveal') {
        setSharedVisible(false)
        setOpen(true)
        setView('editor')
        setPickerOpen(false)
      }
      if (event.data?.type === 'visual-editor:home') {
        setView('home')
        setPickerOpen(false)
      }
      if (event.data?.type === 'visual-editor:escape') {
        if (view === 'editor') send('visual-editor:back')
        else if (view === 'annotations' && annotationEditing)
          send('visual-editor:cancel-annotation')
        else if (view !== 'home') {
          setView('home')
          setPickerOpen(false)
        } else collapse()
      }
      if (event.data?.type === 'visual-editor:collapse') collapse()
      if (event.data?.type === 'visual-editor:toggle') setOpen((value) => !value)
      if (event.data?.type === 'visual-editor:annotation-selection') {
        setAnnotationEditing(Boolean(event.data.selected))
        if (event.data.selected) {
          setOpen(true)
          setView('annotations')
        }
      }
      if (event.data?.type === 'visual-editor:annotations')
        setAnnotationCount(Number(event.data.count) || 0)
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
  }, [pending, busy, navigate, collapse, view, annotationEditing, send])

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
  function editorView(destination: 'blocks' | 'revisions' | 'changes' = 'blocks') {
    changeMode('edit')
    setView('editor')
    setPickerOpen(false)
    send('visual-editor:show', { view: destination })
  }
  function contentView(slug = current.collection) {
    setSourceSlug(slug)
    setSearch('')
    setPage(1)
    setEntries([])
    setPickerOpen(true)
    setView('content')
  }
  const titles = {
    home: 'Workspace',
    content: 'Content',
    shared: 'Shared content',
    editor: 'Edit content',
    annotations: 'Annotations',
    settings: 'Workspace settings',
  }
  const footerStatus =
    saveStatus ||
    (busy
      ? 'Loading content…'
      : changeCount
        ? `${changeCount} ${changeCount === 1 ? 'change' : 'changes'} · Unsaved`
        : 'No pending changes')
  return createPortal(
    <div className={styles.workspace} data-mode={mode} data-visual-editor-workspace ref={root}>
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
      <aside
        aria-label="Floating visual editor"
        className={styles.floating}
        data-dot-position={dotPosition}
        data-open={open}
        data-size={size}
        data-reduce-motion={reduceMotion}
        style={{ '--editor-duration': `${pace}ms` } as React.CSSProperties}
      >
        <button
          aria-label="Open visual editor"
          aria-expanded={open}
          aria-controls="visual-editor-shell"
          className={styles.launcher}
          ref={launcher}
          onClick={reveal}
          tabIndex={open ? -1 : 0}
          aria-hidden={open || undefined}
          type="button"
        >
          <span className={styles.orb}>
            <OakMark />
          </span>
          {pending && <span className={styles.dotBadge} />}
        </button>
        <div className={styles.shell} id="visual-editor-shell" inert={!open || sharedVisible}>
          <header className={styles.header} hidden={view === 'editor'}>
            {view === 'home' ? (
              <span className={styles.identity}>
                <OakMark />
              </span>
            ) : (
              <button
                className={styles.iconButton}
                aria-label="Back"
                onClick={() => {
                  if (view === 'annotations' && annotationEditing) {
                    send('visual-editor:cancel-annotation')
                  } else {
                    setView('home')
                    setPickerOpen(false)
                  }
                }}
                type="button"
              >
                <EditorIcon name="back" />
              </button>
            )}
            <div className={styles.headerCopy}>
              <h2 ref={heading} tabIndex={-1}>
                {titles[view]}
              </h2>
              <small>Oak · Visual editor</small>
            </div>
            {view === 'home' && (
              <button
                className={styles.iconButton}
                aria-label="Workspace settings"
                onClick={() => setView('settings')}
                type="button"
              >
                <EditorIcon name="settings" />
              </button>
            )}
            <button
              className={styles.iconButton}
              aria-label="Collapse editor"
              onClick={collapse}
              type="button"
            >
              <EditorIcon name="minus" />
            </button>
          </header>
          <div
            className={styles.editorHeading}
            id="visual-editor-heading"
            hidden={view !== 'editor'}
            key={`heading:${src}`}
          />
          <div className={styles.views}>
            {view === 'home' && (
              <section className={styles.view} key="home">
                <div className={styles.sectionLabel}>
                  YOU’RE EDITING <span className={styles.tag}>Draft preview</span>
                </div>
                <button className={styles.pageSelect} onClick={() => contentView()} type="button">
                  <span className={styles.pageThumb}>
                    <EditorIcon name="page" />
                  </span>
                  <span className={styles.grow}>
                    <strong title={currentLabel}>{currentLabel}</strong>
                    <small>
                      {sources.find((item) => item.slug === current.collection)?.label ||
                        current.collection}{' '}
                      · {current.locale || 'Default locale'}
                    </small>
                  </span>
                  <EditorIcon name="chevron" />
                </button>
                <div className={styles.sectionLabel}>WORKSPACE MODE</div>
                <nav aria-label="Editor tools" className={styles.segmented}>
                  {(['browse', 'edit', 'annotate'] as const).map((value) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={mode === value}
                      onClick={() => {
                        changeMode(value)
                        if (value === 'annotate') setView('annotations')
                      }}
                    >
                      <EditorIcon
                        name={value === 'browse' ? 'eye' : value === 'edit' ? 'edit' : 'comment'}
                      />
                      {value === 'browse'
                        ? 'Browse'
                        : value === 'edit'
                          ? 'Edit content'
                          : 'Annotate'}
                    </button>
                  ))}
                </nav>
                <div className={styles.cards}>
                  <button
                    className={styles.card}
                    title="Page blocks"
                    disabled={!ready}
                    onClick={() => editorView()}
                    type="button"
                  >
                    <EditorIcon name="layers" />
                    <strong>Page blocks</strong>
                    <small>{blockCount} sections</small>
                  </button>
                  <button
                    className={styles.card}
                    title="Edit content"
                    disabled={!ready}
                    onClick={() => editorView()}
                    type="button"
                  >
                    <EditorIcon name="edit" />
                    <strong>Edit content</strong>
                    <small>Select a field</small>
                  </button>
                  <button
                    className={styles.card}
                    title="Annotations"
                    disabled={!ready}
                    onClick={() => {
                      changeMode('annotate')
                      setView('annotations')
                    }}
                    type="button"
                  >
                    <EditorIcon name="comment" />
                    <strong>Annotations</strong>
                    <small>{annotationCount} notes</small>
                  </button>
                  <button
                    className={styles.card}
                    title="Revisions"
                    disabled={!ready}
                    onClick={() => editorView('revisions')}
                    type="button"
                  >
                    <EditorIcon name="history" />
                    <strong>Revisions</strong>
                    <small>Changes & saved versions</small>
                  </button>
                </div>
                <div className={styles.sectionLabel}>SHARED CONTENT</div>
                <button className={styles.row} onClick={() => setView('shared')} type="button">
                  <span className={styles.tile}>
                    <EditorIcon name="globe" />
                  </span>
                  <span className={styles.grow}>
                    <strong>Menus & globals</strong>
                    <small>Navigation, footer, site settings</small>
                  </span>
                  <EditorIcon name="chevron" />
                </button>
                <div className={styles.previewControls}>
                  <span>Preview width</span>
                  <div aria-label="Preview width" className={styles.segmented}>
                    {(['desktop', 'mobile'] as const).map((value) => (
                      <button
                        aria-label={`${value === 'desktop' ? 'Desktop' : 'Mobile'} preview`}
                        aria-pressed={viewport === value}
                        key={value}
                        onClick={() => setViewport(value)}
                        type="button"
                      >
                        <EditorIcon name={value} />
                        {value === 'desktop' ? 'Desktop' : 'Mobile'}
                      </button>
                    ))}
                  </div>
                </div>
                <p className={styles.hint}>
                  <EditorIcon name="edit" />
                  {mode === 'browse'
                    ? 'Browse the page with editing outlines hidden.'
                    : mode === 'annotate'
                      ? 'Click an element on the page to leave feedback.'
                      : 'Click a heading or image on the page to jump straight into its controls.'}
                </p>
              </section>
            )}
            {view === 'content' && (
              <section
                aria-label="Content navigation"
                id="visual-editor-navigation"
                className={styles.view}
                key="content"
              >
                <label className={styles.field}>
                  Content source
                  <select
                    aria-label="Content source"
                    value={sourceSlug}
                    onChange={(event) => contentView(event.target.value)}
                  >
                    {sources.map((item) => (
                      <option key={item.slug} value={item.slug}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </label>
                {source?.global && source.editable ? (
                  <button
                    className={styles.row}
                    onClick={() =>
                      openShared({ slug: source.slug, global: true, label: source.label })
                    }
                  >
                    {source.label}
                    <EditorIcon name="chevron" />
                  </button>
                ) : source?.global ? (
                  <a
                    className={styles.row}
                    href={`${adminRoute}/globals/${source.slug}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open {source.label} in Payload ↗
                  </a>
                ) : (
                  <>
                    <input
                      aria-label="Search content"
                      placeholder="Search content…"
                      className={styles.search}
                      value={search}
                      onChange={(event) => {
                        setSearch(event.target.value)
                        setPage(1)
                      }}
                    />
                    {loading ? (
                      <p role="status">Loading content…</p>
                    ) : (
                      <ul className={styles.entries}>
                        {entries.map((entry) => (
                          <li key={entry.id}>
                            {source?.editable ? (
                              <button
                                className={styles.row}
                                title={entry.label}
                                onClick={() =>
                                  openShared({
                                    slug: source.slug,
                                    id: entry.id,
                                    label: entry.label,
                                  })
                                }
                              >
                                <span className={styles.grow}>
                                  <strong>{entry.label}</strong>
                                </span>
                                <EditorIcon name="chevron" />
                              </button>
                            ) : entry.url ? (
                              <button
                                className={styles.row}
                                title={entry.label}
                                aria-current={current.id === entry.id ? 'page' : undefined}
                                disabled={busy}
                                onClick={() => (pending ? setNavigation(entry) : navigate(entry))}
                                type="button"
                              >
                                <EditorIcon name="page" />
                                <span className={styles.grow}>
                                  <strong>{entry.label}</strong>
                                </span>
                                <EditorIcon name={current.id === entry.id ? 'check' : 'chevron'} />
                              </button>
                            ) : (
                              <a
                                className={styles.row}
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
            {view === 'shared' && (
              <section className={styles.view} key="shared">
                {sources
                  .filter((item) => item.slug !== current.collection)
                  .map((item) => (
                    <button
                      className={styles.row}
                      key={item.slug}
                      onClick={() => contentView(item.slug)}
                      type="button"
                    >
                      <span className={styles.tile}>
                        <EditorIcon name="globe" />
                      </span>
                      <span className={styles.grow}>
                        <strong>{item.label}</strong>
                        <small>{item.global ? 'Global settings' : 'Shared content'}</small>
                      </span>
                      <EditorIcon name="chevron" />
                    </button>
                  ))}
              </section>
            )}
            {view === 'settings' && (
              <section className={styles.view} key="settings">
                <div className={styles.sectionLabel}>DOT PLACEMENT</div>
                <div className={styles.segmented}>
                  {(
                    [
                      ['top-right', 'Top right'],
                      ['right-bottom', 'Right bottom'],
                      ['center-bottom', 'Center bottom'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      aria-pressed={dotPosition === value}
                      key={value}
                      onClick={() => setDotPosition(value)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className={styles.sectionLabel}>SIDEBAR SIZE</div>
                <div className={styles.segmented}>
                  {['standard', 'large'].map((value) => (
                    <button
                      key={value}
                      aria-pressed={size === value}
                      onClick={() => setSize(value)}
                      type="button"
                    >
                      {value === 'standard' ? 'Standard' : 'Large'}
                    </button>
                  ))}
                </div>
                <label className={styles.field}>
                  Animation pace · {pace}ms
                  <input
                    type="range"
                    min="250"
                    max="1200"
                    value={pace}
                    onChange={(event) => setPace(Number(event.target.value))}
                  />
                </label>
                <label className={styles.toggle}>
                  Reduce motion
                  <input
                    type="checkbox"
                    checked={reduceMotion}
                    onChange={(event) => setReduceMotion(event.target.checked)}
                  />
                </label>
                <p className={styles.hint}>
                  E opens or collapses the editor. Escape goes back one layer.
                </p>
                <a className={styles.row} href={adminURL} target="_blank" rel="noreferrer">
                  Open in Payload ↗
                </a>
              </section>
            )}
            <div
              className={styles.panel}
              hidden={view !== 'editor'}
              id="visual-editor-panel"
              key={`panel:${src}`}
            />
            <div
              className={styles.annotations}
              hidden={view !== 'annotations'}
              id="visual-editor-annotations"
              key={`annotations:${src}`}
            />
          </div>
          <footer className={styles.footer}>
            <div className={styles.changeLine}>
              <button
                className={styles.changeStatus}
                aria-label={footerStatus}
                disabled={!ready}
                onClick={() => (sharedPending ? setSharedVisible(true) : editorView('changes'))}
                type="button"
              >
                <span data-pending={pending} />
                <span role="status" aria-live="polite" aria-atomic="true">
                  {sharedPending ? 'Shared edits pending' : footerStatus}
                </span>
              </button>
              <div
                className={styles.historyActions}
                id="visual-editor-history-actions"
                key={`history:${src}`}
              />
            </div>
            <div
              className={styles.actions}
              hidden={sharedPending}
              id="visual-editor-actions"
              key={`actions:${src}`}
            />
            {sharedPending && (
              <button className={styles.row} onClick={() => setSharedVisible(true)}>
                Review shared changes
              </button>
            )}
          </footer>
        </div>
        {sharedTarget && (
          <SharedContentEditor
            key={`${current.locale}:${sharedEpoch}`}
            onStateChange={(pending, busy) => {
              setSharedPending(pending)
              setSharedBusy(busy)
            }}
            target={sharedTarget}
            locale={current.locale}
            apiRoute={apiRoute}
            hidden={!sharedVisible || !open}
            enabledSources={sources.filter((s) => s.editable)}
            onOpen={openShared}
            onClose={() => {
              const previous = sharedTrail.at(-1)
              if (previous) {
                setSharedTarget(previous)
                setSharedTrail((t) => t.slice(0, -1))
              } else setSharedVisible(false)
            }}
            onCollapse={collapse}
            onPreview={(target, document, focusPath) => {
              sharedPreviews.current.set(`${target.slug}:${target.id ?? ''}`, {
                target,
                document,
                focusPath,
              })
              send('visual-editor:shared-preview', { target, document, focusPath })
            }}
            onSaved={() => send('visual-editor:refresh-shared')}
          />
        )}
      </aside>
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
