'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'

import type { Annotation, PayloadCMSDocument } from '../../types.js'

import { usePreviewRefresh } from '../../hooks/use-preview-refresh.js'
import { type ArrayRow, type ArrangeSnapshot, remapArrangePath } from '../../utils/arrange.js'
import { documentKey, fieldDocument } from '../../utils/field-target.js'
import { type MediaChoice, MediaPicker } from '../media-picker/index.js'
import { imageFieldAt, previewImages } from '../media-picker/preview.js'
import { RevisionHistory } from '../revision-history/index.js'
import { RichTextDialog } from '../rich-text-editor/dialog.js'
import styles from './styles.module.scss'
import { ArrayEditor } from './array-editor.js'

type Session = {
  changes: Record<string, unknown>
  media: Record<string, MediaChoice>
  orders: Record<string, string[]>
  owner: PayloadCMSDocument
  snapshot: ArrangeSnapshot
}
type Target = { key: string; path: string }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const humanize = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase())
function fieldLabel(path: string, session: Session) {
  const parts = path.split('.')
  const label = humanize(parts.at(-1) || 'Content')
  for (const [orderPath, rows] of Object.entries(session.snapshot.orders)) {
    if (!path.startsWith(`${orderPath}.`)) {
      continue
    }
    const index = Number(path.slice(orderPath.length + 1).split('.')[0])
    if (rows[index]) {
      return `${label} · ${humanize(rows[index].label)} ${index + 1}`
    }
  }
  return label
}

function Portal({ children, container }: { children: ReactNode; container?: HTMLElement }) {
  return container ? createPortal(children, container) : children
}

export function ArrangeEditor({
  actionsContainer,
  active,
  adminRoute,
  apiRoute,
  documentInfo,
  onClose,
  onPendingChange,
  panelContainer,
}: {
  actionsContainer?: HTMLElement
  active: boolean
  adminRoute: string
  apiRoute: string
  documentInfo: PayloadCMSDocument
  onClose: () => void
  onPendingChange?: (pending: boolean, busy: boolean) => void
  panelContainer?: HTMLElement
}) {
  const [tab, setTab] = useState<'content' | 'revisions'>('content')
  const [revisionRefresh, setRevisionRefresh] = useState(0)
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === window.parent &&
        event.data?.type === 'visual-editor:show-revisions'
      ) {
        setTab('revisions')
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [target, setTarget] = useState<Target>()
  const [picker, setPicker] = useState<Target>()
  const [richText, setRichText] = useState<Target>()
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [needsSync, setNeedsSync] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const refreshPreview = usePreviewRefresh()
  const committed = useRef(new Set<string>())
  const nextTarget = useRef<Target | undefined>(undefined)
  const saving = useRef(false)
  const [dragging, setDragging] = useState<{ id: string; key: string; path: string }>()
  const initialised = useRef(false)
  const count = Object.values(sessions).reduce(
    (total, session) =>
      total +
      (committed.current.has(documentKey(session.owner))
        ? 0
        : Object.keys(session.changes).length + Object.keys(session.orders).length),
    0,
  )
  useEffect(() => {
    onPendingChange?.(count > 0 || needsSync, busy)
  }, [count, needsSync, busy, onPendingChange])
  const session = target && sessions[target.key]
  const field = target && session?.snapshot.fields[target.path]
  const value =
    target &&
    session &&
    (Object.hasOwn(session.changes, target.path) ? session.changes[target.path] : field?.value)

  const request = useCallback(
    async (owner: PayloadCMSDocument, data: Record<string, unknown>) => {
      const response = await fetch(`${apiRoute}/payload-visual-editor/arrange`, {
        body: JSON.stringify({ ...owner, ...data }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || 'Unable to load editor')
      }
      return result
    },
    [apiRoute],
  )

  const readSession = useCallback(
    async (owner: PayloadCMSDocument) => {
      const key = documentKey(owner)
      const paths = new Set<string>()
      const orderPaths = new Set<string>()
      for (const element of document.querySelectorAll(
        '[data-payload-path], [data-payload-block-list], [data-payload-array-path]',
      )) {
        if (documentKey(fieldDocument(element, documentInfo)) !== key) {
          continue
        }
        const path =
          element.getAttribute('data-payload-path') ||
          element.getAttribute('data-payload-array-path')
        const orderPath = element.getAttribute('data-payload-block-list')
        if (path) {
          paths.add(path)
        }
        if (orderPath) {
          orderPaths.add(orderPath)
        }
      }
      const snapshot = await request(owner, {
        action: 'read',
        orderPaths: [...orderPaths],
        paths: [...paths],
      })
      for (const list of document.querySelectorAll<HTMLElement>('[data-payload-block-list]')) {
        if (documentKey(fieldDocument(list, documentInfo)) !== key) {
          continue
        }
        const rows = snapshot.orders[list.dataset.payloadBlockList!]
        const rendered = [...list.children].map(
          (child) => (child as HTMLElement).dataset.payloadBlockId,
        )
        if (
          rows &&
          !same(
            rows.map((row: { id: string }) => row.id),
            rendered,
          )
        ) {
          throw new Error('The page layout changed. Reload the preview before editing.')
        }
      }
      return { changes: {}, media: {}, orders: {}, owner, snapshot } as Session
    },
    [documentInfo, request],
  )

  useEffect(() => {
    if (!active) {
      // Inline editing can save the same document while this panel is closed.
      if (!count && !busy) {
        initialised.current = false
      }
      return
    }
    if (initialised.current) {
      return
    }
    initialised.current = true
    const owners = new Map<string, PayloadCMSDocument>()
    for (const element of document.querySelectorAll(
      '[data-payload-path], [data-payload-block-list], [data-payload-array-path]',
    )) {
      const owner = fieldDocument(element, documentInfo)
      if (owner) {
        owners.set(documentKey(owner), owner)
      }
    }
    setBusy(true)
    void (async () => {
      const loaded: Record<string, Session> = {}
      const failures: string[] = []
      for (const [key, owner] of owners) {
        try {
          const loadedSession = await readSession(owner)
          loaded[key] = loadedSession
        } catch (cause) {
          failures.push(cause instanceof Error ? cause.message : 'Unable to load content')
        }
      }
      setSessions(loaded)
      setError(failures.join(' '))
      setReady(true)
      setBusy(false)
    })()
  }, [active, busy, count, documentInfo, readSession])

  useEffect(() => {
    if (!count) {
      return
    }
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [count])

  useEffect(() => {
    if (!active) {
      return
    }
    const elements = [
      ...document.querySelectorAll<HTMLElement>('[data-payload-path], [data-payload-block-id]'),
    ]
    const focusable = elements.filter(
      (element) => element.hasAttribute('data-payload-path') && element.tagName !== 'SOURCE',
    )
    const tabIndexes = focusable.map((element) => element.getAttribute('tabindex'))
    for (const element of elements) {
      element.setAttribute('data-arrange-editable', '')
    }
    focusable.forEach((element) => {
      element.tabIndex = 0
    })
    const select = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null
      if (!element || element.closest('[data-feedback-toolbar], [data-annotation-popup]')) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      if (busy || needsSync) {
        return
      }
      const editable = element.closest('[data-payload-path]')
      if (!editable) {
        setTarget(undefined)
        setStatus(
          element.closest('[data-payload-block-id]')
            ? 'Move this block using the Blocks list.'
            : 'Select outlined text or an image to edit.',
        )
        return
      }
      const owner = fieldDocument(editable, documentInfo)
      const key = documentKey(owner)
      const path =
        imageFieldAt(element as HTMLElement)?.path ?? editable.getAttribute('data-payload-path')!
      if (!sessions[key]?.snapshot.fields[path]) {
        setError('This field is unavailable here. Use the full CMS editor.')
        return
      }
      setError('')
      setStatus('')
      setTab('content')
      setTarget({ key, path })
    }
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        event.target instanceof HTMLElement &&
        event.target.matches('[data-payload-path]')
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        event.target.click()
      }
    }
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('click', select, true)
    return () => {
      elements.forEach((element) => element.removeAttribute('data-arrange-editable'))
      focusable.forEach((element, index) =>
        tabIndexes[index] === null
          ? element.removeAttribute('tabindex')
          : element.setAttribute('tabindex', tabIndexes[index]),
      )
      document.removeEventListener('keydown', keyboard, true)
      document.removeEventListener('click', select, true)
    }
  }, [active, busy, needsSync, sessions, documentInfo])

  // Release DOM previews before React merges the saved server-rendered content.
  useEffect(() => {
    if (refreshing) {
      return
    }
    const restore: (() => void)[] = []
    for (const element of document.querySelectorAll<HTMLElement>('[data-payload-path]')) {
      const key = documentKey(fieldDocument(element, documentInfo))
      const path = element.dataset.payloadPath!
      const current = sessions[key]
      if (active && target?.key === key && target.path === path) {
        element.setAttribute('data-arrange-selected', '')
        restore.push(() => element.removeAttribute('data-arrange-selected'))
      }
      if (!current || committed.current.has(key) || !Object.hasOwn(current.changes, path)) {
        continue
      }
      const field = current.snapshot.fields[path]
      if (!field) continue
      if (field.type === 'text' || field.type === 'textarea') {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        const nodes: Text[] = []
        while (walker.nextNode()) {
          nodes.push(walker.currentNode as Text)
        }
        if (!nodes.length) {
          const node = document.createTextNode('')
          element.append(node)
          nodes.push(node)
          restore.push(() => node.remove())
        }
        nodes.forEach((node, index) => {
          const original = node.data
          node.data = index === 0 ? String(current.changes[path]) : ''
          restore.push(() => {
            node.data = original
          })
        })
      }
    }
    const mediaAnnotations = Object.values(sessions)
      .filter((session) => !committed.current.has(documentKey(session.owner)))
      .flatMap((session) =>
        Object.entries(session.media).map(
          ([path, media]) =>
            ({
              media,
              payloadCMS: { document: session.owner, path, value: String(media.id) },
            }) as Annotation,
        ),
      )
    restore.push(previewImages(mediaAnnotations, document, documentInfo))
    for (const list of document.querySelectorAll<HTMLElement>('[data-payload-block-list]')) {
      const current = sessions[documentKey(fieldDocument(list, documentInfo))]
      const ids = current?.orders[list.dataset.payloadBlockList!]
      if (!ids || committed.current.has(documentKey(current.owner))) {
        continue
      }
      for (const element of list.children) {
        if (!(element instanceof HTMLElement)) {
          continue
        }
        const original = element.style.order
        element.style.order = String(ids.indexOf(element.dataset.payloadBlockId!))
        restore.push(() => {
          element.style.order = original
        })
      }
    }
    return () => restore.reverse().forEach((undo) => undo())
  }, [active, sessions, target, documentInfo, refreshing])

  function stage(target: Target, value: unknown, media?: MediaChoice) {
    setError('')
    setSessions((previous) => {
      const session = previous[target.key]
      const changes = { ...session.changes }
      const choices = { ...session.media }
      if (same(value, session.snapshot.fields[target.path].value)) {
        delete changes[target.path]
        delete choices[target.path]
      } else {
        changes[target.path] = value
        if (media) {
          choices[target.path] = media
        }
      }
      return { ...previous, [target.key]: { ...session, changes, media: choices } }
    })
    setStatus('Changes added. Keep editing, then save or publish all.')
  }

  function move(key: string, path: string, id: string, destination: number) {
    setStatus('')
    setError('')
    setSessions((previous) => {
      const session = previous[key]
      const original = session.snapshot.orders[path].map((row) => row.id)
      const ids = [...(session.orders[path] ?? original)]
      const index = ids.indexOf(id)
      if (index < 0 || destination < 0 || destination >= ids.length) {
        return previous
      }
      ids.splice(index, 1)
      ids.splice(destination, 0, id)
      const orders = { ...session.orders }
      if (same(ids, original)) {
        delete orders[path]
      } else {
        orders[path] = ids
      }
      return { ...previous, [key]: { ...session, orders } }
    })
  }

  async function syncPreview() {
    // Flush cleanup before React touches the same text, image and order attributes.
    flushSync(() => setRefreshing(true))
    try {
      await refreshPreview()
      const loaded = await Promise.all(
        [...committed.current].map(
          async (key) => [key, await readSession(sessions[key].owner)] as const,
        ),
      )
      setSessions((previous) => ({ ...previous, ...Object.fromEntries(loaded) }))
      committed.current.clear()
      if (nextTarget.current) {
        setTarget(nextTarget.current)
        nextTarget.current = undefined
      }
      setNeedsSync(false)
    } finally {
      setRefreshing(false)
    }
  }

  async function retryPreview() {
    if (saving.current) {
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    try {
      await syncPreview()
      setStatus('Preview updated.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update preview')
    } finally {
      saving.current = false
      setBusy(false)
    }
  }

  async function submit(action: 'publish' | 'save') {
    if (saving.current || busy || needsSync) {
      return
    }
    saving.current = true
    setBusy(true)
    setError('')
    setStatus('')
    let completed = 0
    const savedKey = `visual-editor-drafts:${documentKey(documentInfo)}`
    let savedOwners: string[] = []
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(savedKey) || '[]')
      if (Array.isArray(stored)) {
        savedOwners = stored.filter((key): key is string => typeof key === 'string')
      }
    } catch {
      /* Storage is optional. */
    }
    const remember = () => {
      try {
        sessionStorage.setItem(savedKey, JSON.stringify(savedOwners))
      } catch {
        /* Storage is optional. */
      }
    }
    const publishPrimaryDraft = count === 0 && savedOwners.length === 0
    try {
      for (const [key, session] of Object.entries(sessions)) {
        const changed = Object.keys(session.changes).length || Object.keys(session.orders).length
        if (
          !changed &&
          (action !== 'publish' ||
            (!savedOwners.includes(key) &&
              !(publishPrimaryDraft && key === documentKey(documentInfo))))
        ) {
          continue
        }
        const paths = Object.keys(session.snapshot.fields)
        const orderPaths = Object.keys(session.snapshot.orders)
        await request(session.owner, {
          action,
          changes: Object.entries(session.changes).map(([path, value]) => ({ path, value })),
          orderPaths,
          orders: Object.entries(session.orders).map(([path, ids]) => ({ ids, path })),
          paths,
          revision: session.snapshot.revision,
        })
        completed++
        setRevisionRefresh((value) => value + 1)
        committed.current.add(key)
        if (
          Object.keys(session.changes).some(
            (path) => session.snapshot.fields[path].type === 'array',
          )
        ) {
          setTarget(undefined)
          nextTarget.current = undefined
        } else if (target?.key === key) {
          nextTarget.current = {
            key,
            path: remapArrangePath(target.path, session.snapshot.orders, session.orders),
          }
        }
        savedOwners =
          action === 'save'
            ? [...new Set([key, ...savedOwners])]
            : savedOwners.filter((owner) => owner !== key)
        remember()
        setSessions((previous) => ({
          ...previous,
          [key]: { ...previous[key], changes: {}, media: {}, orders: {} },
        }))
      }
      setStatus(action === 'publish' ? 'All changes published.' : 'Draft saved.')
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : 'Unable to save changes'}${completed ? ` ${completed} document(s) already saved. Remaining changes can be retried.` : ' Your changes are still here. Try saving again.'}`,
      )
    } finally {
      if (committed.current.size) {
        // Committed operations must never be replayed, even if refreshing fails.
        setNeedsSync(true)
        try {
          await syncPreview()
        } catch (cause) {
          setError(
            `Changes saved, but the preview could not update. ${cause instanceof Error ? cause.message : ''}`,
          )
        }
      }
      saving.current = false
      setBusy(false)
    }
  }

  return (
    <>
      {active && (
        <Portal container={panelContainer}>
          <aside aria-label="Edit content" className={styles.panel} data-feedback-toolbar>
            <header>
              <div>
                <small>VISUAL EDITOR</small>
                <h2>{tab === 'revisions' ? 'Revision history' : 'Edit content'}</h2>
              </div>
              <div className={styles.headerActions}>
                <button
                  aria-label="Revision history"
                  aria-pressed={tab === 'revisions'}
                  className={styles.revisionToggle}
                  onClick={() =>
                    setTab((current) => (current === 'content' ? 'revisions' : 'content'))
                  }
                  title={tab === 'revisions' ? 'Show content' : 'Show revisions'}
                  type="button"
                >
                  <svg
                    aria-hidden="true"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
                <button aria-label="Close content editor" onClick={onClose} type="button">
                  ×
                </button>
              </div>
            </header>
            <div className={styles.content}>
              {!ready && <p role="status">Loading editable content…</p>}
              <div hidden={tab !== 'content'}>
                {field && target && (
                  <section aria-label="Selected content">
                    <h3>{field.type === 'upload' ? 'Image' : 'Text'}</h3>
                    <small className={styles.path}>
                      {session && fieldLabel(target.path, session)}
                    </small>
                    {(field.type === 'text' || field.type === 'textarea') && (
                      <label>
                        Replacement text
                        <textarea
                          aria-label="Replacement text"
                          disabled={busy || needsSync}
                          onChange={(event) => stage(target, event.target.value)}
                          rows={5}
                          value={typeof value === 'string' ? value : ''}
                        />
                      </label>
                    )}
                    {field.type === 'upload' && (
                      <button
                        disabled={busy || needsSync}
                        onClick={() => setPicker(target)}
                        type="button"
                      >
                        Replace image
                      </button>
                    )}
                    {field.type === 'richText' && (
                      <button
                        disabled={busy || needsSync}
                        onClick={() => setRichText(target)}
                        type="button"
                      >
                        Edit formatted text
                      </button>
                    )}
                  </section>
                )}
                {Object.entries(sessions).flatMap(([key, session]) =>
                  Object.entries(session.snapshot.fields).map(([path, field]) =>
                    field.type === 'array' ? (
                      <ArrayEditor
                        key={`${key}:${path}`}
                        field={field}
                        value={(session.changes[path] ?? field.value) as ArrayRow[]}
                        disabled={busy || needsSync}
                        onChange={(rows) => stage({ key, path }, rows)}
                      />
                    ) : null,
                  ),
                )}
                {Object.values(sessions).some(
                  (session) => Object.keys(session.snapshot.orders).length > 0,
                ) && (
                  <section aria-label="Blocks">
                    <h3>Blocks</h3>
                    <p>Drag a handle or use the arrows to move a block.</p>
                    {Object.entries(sessions).flatMap(([key, session]) =>
                      Object.entries(session.snapshot.orders).map(([path, rows]) => {
                        const ids = session.orders[path] ?? rows.map((row) => row.id)
                        return (
                          <ol
                            aria-label={`${path} block order`}
                            className={styles.blocks}
                            key={`${key}:${path}`}
                          >
                            {ids.map((id, index) => (
                              <li
                                key={id}
                                onDragOver={(event) => {
                                  if (dragging?.key === key && dragging.path === path) {
                                    event.preventDefault()
                                  }
                                }}
                                onDrop={(event) => {
                                  event.preventDefault()
                                  if (
                                    !busy &&
                                    !needsSync &&
                                    dragging?.key === key &&
                                    dragging.path === path
                                  ) {
                                    move(key, path, dragging.id, index)
                                  }
                                  setDragging(undefined)
                                }}
                              >
                                <button
                                  aria-label={`Drag ${humanize(rows.find((row) => row.id === id)?.label || 'Block')}`}
                                  className={styles.handle}
                                  draggable={!busy && !needsSync}
                                  onDragEnd={() => setDragging(undefined)}
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData('text/plain', id)
                                    event.dataTransfer.effectAllowed = 'move'
                                    setDragging({ id, key, path })
                                  }}
                                  type="button"
                                >
                                  ⠿
                                </button>
                                <span>
                                  {humanize(rows.find((row) => row.id === id)?.label || 'Block')}
                                </span>
                                <button
                                  aria-label={`Move ${humanize(rows.find((row) => row.id === id)?.label || 'Block')} up`}
                                  disabled={busy || needsSync || index === 0}
                                  onClick={() => move(key, path, id, index - 1)}
                                  type="button"
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label={`Move ${humanize(rows.find((row) => row.id === id)?.label || 'Block')} down`}
                                  disabled={busy || needsSync || index === ids.length - 1}
                                  onClick={() => move(key, path, id, index + 1)}
                                  type="button"
                                >
                                  ↓
                                </button>
                              </li>
                            ))}
                          </ol>
                        )
                      }),
                    )}
                  </section>
                )}
              </div>
              <section aria-label="Pending changes">
                <h3>
                  Unsaved changes <span>{count}</span>
                </h3>
                {count === 0 && <p>No pending changes.</p>}
                <ul className={styles.pending}>
                  {Object.entries(sessions).flatMap(([key, session]) => [
                    ...Object.keys(session.changes).map((path) => (
                      <li key={`${key}:${path}`}>
                        <button
                          onClick={() => {
                            setTab('content')
                            setTarget({ key, path })
                          }}
                          type="button"
                        >
                          {fieldLabel(path, session)}
                          <small>
                            {session.snapshot.fields[path].type === 'array'
                              ? 'Products changed'
                              : session.snapshot.fields[path].type === 'upload'
                                ? 'Image replaced'
                                : session.snapshot.fields[path].type === 'richText'
                                  ? 'Formatted text edited'
                                  : String(session.changes[path])}
                          </small>
                        </button>
                        <button
                          aria-label={`Undo ${fieldLabel(path, session)}`}
                          disabled={busy || needsSync}
                          onClick={() => stage({ key, path }, session.snapshot.fields[path].value)}
                          type="button"
                        >
                          Undo
                        </button>
                      </li>
                    )),
                    ...Object.keys(session.orders).map((path) => (
                      <li key={`${key}:order:${path}`}>
                        <span>{humanize(path)}: blocks reordered</span>
                        <button
                          disabled={busy || needsSync}
                          onClick={() =>
                            setSessions((previous) => {
                              const orders = { ...previous[key].orders }
                              delete orders[path]
                              return { ...previous, [key]: { ...previous[key], orders } }
                            })
                          }
                          type="button"
                        >
                          Undo
                        </button>
                      </li>
                    )),
                  ])}
                </ul>
              </section>
              {tab === 'revisions' && (
                <RevisionHistory
                  apiRoute={apiRoute}
                  key={documentKey(documentInfo)}
                  owner={documentInfo}
                  refresh={revisionRefresh}
                />
              )}
              {error && (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              )}
              {needsSync && !busy && (
                <button onClick={() => void retryPreview()} type="button">
                  Retry preview update
                </button>
              )}
              <p>Publish all publishes the full draft of each changed document.</p>
              <p role="status">
                {busy && ready ? (refreshing ? 'Updating preview…' : 'Saving…') : status}
              </p>
            </div>
            <Portal container={actionsContainer}>
              <footer
                aria-label="Save or publish the document draft"
                className={actionsContainer ? styles.actions : undefined}
              >
                <button
                  disabled={busy || needsSync || !count}
                  onClick={() => void submit('save')}
                  type="button"
                >
                  Save draft{count > 0 && <span className={styles.count}>{count}</span>}
                </button>
                <button
                  className={styles.primary}
                  disabled={busy || needsSync || !ready || !Object.keys(sessions).length}
                  onClick={() => void submit('publish')}
                  type="button"
                >
                  Publish all
                </button>
              </footer>
            </Portal>
          </aside>
        </Portal>
      )}
      {picker && (
        <MediaPicker
          adminRoute={adminRoute}
          apiRoute={apiRoute}
          documentInfo={sessions[picker.key].owner}
          onClose={() => setPicker(undefined)}
          onSelect={(media) => {
            stage(picker, media.id, media)
            setPicker(undefined)
          }}
          path={picker.path}
        />
      )}
      {richText && (
        <RichTextDialog
          adminRoute={adminRoute}
          documentInfo={sessions[richText.key].owner}
          onClose={() => setRichText(undefined)}
          onStage={(value) => {
            stage(richText, value)
            setRichText(undefined)
          }}
          path={richText.path}
          stagedValue={
            sessions[richText.key].changes[richText.path] ??
            sessions[richText.key].snapshot.fields[richText.path].value
          }
        />
      )}
    </>
  )
}
