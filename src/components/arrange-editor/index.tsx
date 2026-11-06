'use client'

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'

import type { Annotation, PayloadCMSDocument } from '../../types.js'

import { usePreviewRefresh } from '../../hooks/use-preview-refresh.js'
import { type ArrayRow, type ArrangeSnapshot, remapArrangePath } from '../../utils/arrange.js'
import { documentKey, fieldDocument } from '../../utils/field-target.js'
import { type MediaChoice, MediaPicker } from '../media-picker/index.js'
import { imageFieldAt, previewImages } from '../media-picker/preview.js'
import { RevisionHistory } from '../revision-history/index.js'
import { RichTextSidebar } from '../rich-text-editor/sidebar.js'
import { EditorIcon } from '../workspace/icons.js'
import styles from './styles.module.scss'
import { ArrayEditor } from './array-editor.js'
import { createCanvasTextEditor } from './canvas-text.js'

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
  headerContainer,
  historyContainer,
  onReveal,
  onHome,
}: {
  actionsContainer?: HTMLElement
  active: boolean
  adminRoute: string
  apiRoute: string
  documentInfo: PayloadCMSDocument
  onClose: () => void
  onPendingChange?: (
    pending: boolean,
    busy: boolean,
    count: number,
    status: string,
    blocks: number,
  ) => void
  headerContainer?: HTMLElement
  historyContainer?: HTMLElement
  onReveal?: () => void
  onHome?: () => void
  panelContainer?: HTMLElement
}) {
  const [tab, setTab] = useState<'menu' | 'content' | 'revisions' | 'changes'>(
    panelContainer ? 'content' : 'menu',
  )
  const [blockMode, setBlockMode] = useState<'edit' | 'rearrange'>('edit')
  const [revisionRefresh, setRevisionRefresh] = useState(0)
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [undoStack, setUndoStack] = useState<Record<string, Session>[]>([])
  const [redoStack, setRedoStack] = useState<Record<string, Session>[]>([])
  function rememberEdit() {
    setUndoStack((previous) => [...previous.slice(-59), sessions])
    setRedoStack([])
  }
  const [target, setTarget] = useState<Target>()
  const [selectedRow, setSelectedRow] = useState<string>()
  const [selectedBlock, setSelectedBlock] = useState<{
    key: string
    path: string
    id: string
  }>()
  const heading = useRef<HTMLHeadingElement>(null)
  const selectedSession = selectedBlock && sessions[selectedBlock.key]
  const selectedIndex =
    selectedBlock &&
    selectedSession?.snapshot.orders[selectedBlock.path]?.findIndex(
      (row) => row.id === selectedBlock.id,
    )
  const blockPath =
    selectedBlock && selectedIndex !== undefined && selectedIndex >= 0
      ? `${selectedBlock.path}.${selectedIndex}`
      : undefined
  const blockLabel =
    selectedBlock && selectedIndex !== undefined
      ? selectedSession?.snapshot.orders[selectedBlock.path]?.[selectedIndex]?.label
      : undefined
  const viewKey = target
    ? `${target.key}:${target.path}`
    : selectedRow
      ? selectedRow
      : selectedBlock
        ? `${selectedBlock.key}:${selectedBlock.id}`
        : 'blocks'
  useEffect(() => {
    if (active && !document.activeElement?.hasAttribute('data-arrange-inline'))
      heading.current?.focus({ preventScroll: true })
  }, [viewKey, active, tab])
  function selectBlock(key: string, path: string, id: string) {
    onReveal?.()
    for (const list of document.querySelectorAll<HTMLElement>('[data-payload-block-list]')) {
      if (
        list.dataset.payloadBlockList !== path ||
        documentKey(fieldDocument(list, documentInfo)) !== key
      )
        continue
      const block = [...list.children].find(
        (child) => (child as HTMLElement).dataset.payloadBlockId === id,
      )
      block?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      })
      if (block) break
    }
    setSelectedRow(undefined)
    setSelectedBlock({ key, path, id })
    setTarget(undefined)
    setTab('content')
    setBlockMode('edit')
  }
  function selectField(key: string, path: string) {
    onReveal?.()
    const order = Object.entries(sessions[key].snapshot.orders)
      .filter(([orderPath]) => path.startsWith(`${orderPath}.`))
      .sort(([a], [b]) => b.length - a.length)[0]
    const row = order?.[1][Number(path.slice(order[0].length + 1).split('.')[0])]
    setSelectedBlock(order && row ? { key, path: order[0], id: row.id } : undefined)
    setSelectedRow(undefined)
    setTarget({ key, path })
    setBlockMode('edit')
    setTab('content')
  }
  const blockFields =
    selectedSession && blockPath
      ? Object.entries(selectedSession.snapshot.fields).filter(
          ([path, field]) =>
            path.startsWith(`${selectedRow || blockPath}.`) &&
            field.type !== 'array' &&
            (Boolean(selectedRow) ||
              !Object.entries(selectedSession.snapshot.fields).some(
                ([arrayPath, array]) => array.type === 'array' && path.startsWith(`${arrayPath}.`),
              )),
        )
      : []
  const [picker, setPicker] = useState<Target>()
  const [sidebarSize, setSidebarSize] = useState<'standard' | 'large'>('standard')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'save' | 'publish' | 'refresh'>('save')
  const [ready, setReady] = useState(false)
  const [needsSync, setNeedsSync] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const refreshPreview = usePreviewRefresh()
  const committed = useRef(new Set<string>())
  const nextTarget = useRef<Target | undefined>(undefined)
  const saving = useRef(false)
  const [dragging, setDragging] = useState<{
    id: string
    key: string
    path: string
  }>()
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
    onPendingChange?.(
      count > 0 || needsSync,
      busy,
      count,
      busy
        ? !ready
          ? 'Loading content…'
          : refreshing || operation === 'refresh'
            ? 'Updating preview…'
            : operation === 'publish'
              ? 'Publishing…'
              : 'Saving draft…'
        : status,
      Object.values(sessions).reduce(
        (total, session) =>
          total +
          Object.values(session.snapshot.orders).reduce((sum, rows) => sum + rows.length, 0),
        0,
      ),
    )
  }, [count, needsSync, busy, status, sessions, onPendingChange, ready, refreshing, operation])

  function goBack() {
    if (picker) setPicker(undefined)
    else if (tab === 'revisions' || tab === 'changes' || tab === 'menu') {
      if (onHome) onHome()
      else setTab('menu')
    } else if (target) setTarget(undefined)
    else if (selectedRow) setSelectedRow(undefined)
    else if (selectedBlock) setSelectedBlock(undefined)
    else if (onHome) onHome()
    else setTab('menu')
  }
  useEffect(() => {
    if (!panelContainer) return
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return
      if (event.data?.type === 'visual-editor:back') goBack()
      if (
        event.data?.type === 'visual-editor:show' &&
        ['blocks', 'revisions', 'changes'].includes(event.data.view)
      ) {
        setPicker(undefined)
        setTarget(undefined)
        setSelectedBlock(undefined)
        setSelectedRow(undefined)
        setBlockMode('edit')
        setTab(event.data.view === 'blocks' ? 'content' : event.data.view)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [panelContainer, picker, tab, target, selectedRow, selectedBlock, onHome])
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
      // Standalone inline editing can save the document while this panel is closed.
      if (!panelContainer && !count && !busy) {
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
  }, [active, busy, count, documentInfo, readSession, panelContainer])

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
      const inline = element.closest<HTMLElement>('[data-arrange-inline]')
      if (!inline || element.closest('a')) event.preventDefault()
      event.stopImmediatePropagation()
      if (busy || needsSync || blockMode === 'rearrange') {
        return
      }
      const editable = element.closest('[data-payload-path]')
      if (!editable) {
        const block = element.closest<HTMLElement>('[data-payload-block-id]')
        const list = block?.closest<HTMLElement>('[data-payload-block-list]')
        if (block?.dataset.payloadBlockId && list?.dataset.payloadBlockList) {
          selectBlock(
            documentKey(fieldDocument(list, documentInfo)),
            list.dataset.payloadBlockList,
            block.dataset.payloadBlockId,
          )
        }
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
      setTab('content')
      selectField(key, path)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        event.target instanceof HTMLElement &&
        event.target.matches('[data-payload-path]') &&
        !event.target.hasAttribute('data-arrange-inline')
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
  }, [active, busy, needsSync, sessions, documentInfo, blockMode])

  function undo() {
    const previous = undoStack.at(-1)
    if (!previous || busy || needsSync) return
    setRedoStack((stack) => [...stack, sessions])
    setUndoStack((stack) => stack.slice(0, -1))
    setSessions(previous)
    setStatus('')
  }
  function redo() {
    const next = redoStack.at(-1)
    if (!next || busy || needsSync) return
    setUndoStack((stack) => [...stack, sessions])
    setRedoStack((stack) => stack.slice(0, -1))
    setSessions(next)
    setStatus('')
  }
  const canvasText = useRef<ReturnType<typeof createCanvasTextEditor> | undefined>(undefined)
  useLayoutEffect(() => {
    const editor = createCanvasTextEditor(document)
    canvasText.current = editor
    return () => {
      editor.destroy()
      canvasText.current = undefined
    }
  }, [])
  useLayoutEffect(() => {
    canvasText.current?.update({
      enabled: active && blockMode === 'edit',
      blocked: busy || needsSync,
      refreshing,
      resolve: (element) => {
        const key = documentKey(fieldDocument(element, documentInfo))
        const path = element.dataset.payloadPath!
        const session = sessions[key]
        const field = session?.snapshot.fields[path]
        if (
          !field ||
          !['text', 'textarea'].includes(field.type) ||
          element.querySelector('[data-payload-path]')
        )
          return
        return {
          key,
          path,
          label: fieldLabel(path, session),
          multiline: field.type === 'textarea',
          value: String(session.changes[path] ?? field.value ?? ''),
          changed: Object.hasOwn(session.changes, path) && !committed.current.has(key),
        }
      },
      onSelect: (field) => selectField(field.key, field.path),
      onChange: (field, value) => stage(field, value),
      onUndo: undo,
      onRedo: redo,
    })
  })

  // Release DOM previews before React merges the saved server-rendered content.
  useEffect(() => {
    if (refreshing) {
      return
    }
    const restore: (() => void)[] = []
    for (const element of document.querySelectorAll<HTMLElement>('[data-payload-path]')) {
      const key = documentKey(fieldDocument(element, documentInfo))
      const path = element.dataset.payloadPath!
      if (active && target?.key === key && target.path === path) {
        element.setAttribute('data-arrange-selected', '')
        restore.push(() => element.removeAttribute('data-arrange-selected'))
      }
    }
    const mediaAnnotations = Object.values(sessions)
      .filter((session) => !committed.current.has(documentKey(session.owner)))
      .flatMap((session) =>
        Object.entries(session.media).map(
          ([path, media]) =>
            ({
              media,
              payloadCMS: {
                document: session.owner,
                path,
                value: String(media.id),
              },
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
    const current = sessions[target.key]
    if (
      !current ||
      same(current.changes[target.path] ?? current.snapshot.fields[target.path].value, value)
    )
      return
    rememberEdit()
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
      return {
        ...previous,
        [target.key]: { ...session, changes, media: choices },
      }
    })
    setStatus('')
  }

  function move(key: string, path: string, id: string, destination: number) {
    rememberEdit()
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
      setSessions((previous) => ({
        ...previous,
        ...Object.fromEntries(loaded),
      }))
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
    setOperation('refresh')
    setBusy(true)
    setError('')
    try {
      await syncPreview()
      setStatus('Preview updated.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update preview')
      setStatus('Saved · Preview update failed')
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
    setOperation(action)
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
          changes: Object.entries(session.changes).map(([path, value]) => ({
            path,
            value,
          })),
          orderPaths,
          orders: Object.entries(session.orders).map(([path, ids]) => ({
            ids,
            path,
          })),
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
          setSelectedRow(undefined)
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
        setUndoStack([])
        setRedoStack([])
        setSessions((previous) => ({
          ...previous,
          [key]: { ...previous[key], changes: {}, media: {}, orders: {} },
        }))
      }
      setStatus(action === 'publish' ? 'All changes published.' : 'Draft saved.')
    } catch (cause) {
      setStatus(
        completed
          ? 'Some changes saved · Retry remaining'
          : action === 'publish'
            ? 'Publish failed · Draft kept'
            : 'Save failed · Changes kept',
      )
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
          setStatus('Saved · Preview update failed')
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
      {historyContainer &&
        createPortal(
          <>
            <button
              aria-label="Undo"
              disabled={busy || needsSync || !undoStack.length}
              type="button"
              onClick={undo}
            >
              <EditorIcon name="undo" />
            </button>
            <button
              aria-label="Redo"
              disabled={busy || needsSync || !redoStack.length}
              type="button"
              onClick={redo}
            >
              <EditorIcon name="redo" />
            </button>
          </>,
          historyContainer,
        )}
      {(active || panelContainer) && (
        <Portal container={panelContainer}>
          <aside
            aria-label="Edit content"
            className={styles.panel}
            data-feedback-toolbar
            data-size={sidebarSize}
          >
            <Portal container={headerContainer}>
              <header>
                <div className={styles.headingGroup}>
                  {(tab !== 'menu' || onHome) && (
                    <button
                      type="button"
                      className={styles.back}
                      aria-label="Back"
                      title="Back"
                      onClick={goBack}
                    >
                      <svg
                        aria-hidden="true"
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m14 6-6 6 6 6" />
                      </svg>
                    </button>
                  )}
                  <h2
                    ref={heading}
                    tabIndex={-1}
                    title={blockLabel ? humanize(blockLabel) : undefined}
                  >
                    {picker && panelContainer
                      ? 'Media library'
                      : tab === 'changes'
                        ? 'Changes'
                        : tab === 'menu'
                          ? 'Menu'
                          : tab === 'revisions'
                            ? 'Revision history'
                            : target
                              ? 'Edit content'
                              : blockLabel
                                ? humanize(blockLabel)
                                : blockMode === 'edit'
                                  ? 'Page blocks'
                                  : 'Rearrange content'}
                  </h2>
                </div>
                <div className={styles.headerActions}>
                  <button
                    aria-label={panelContainer ? 'Collapse editor' : 'Close content editor'}
                    onClick={onClose}
                    type="button"
                  >
                    {panelContainer ? <EditorIcon name="minus" /> : '×'}
                  </button>
                </div>
              </header>
            </Portal>
            <div className={styles.content}>
              {picker && panelContainer && (
                <MediaPicker
                  embedded
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
              {(!picker || !panelContainer) && (
                <>
                  {tab === 'menu' && (
                    <nav aria-label="Editor menu" className={styles.drawerView}>
                      {(['edit', 'rearrange'] as const).map((mode) => (
                        <button
                          className={styles.fieldLink}
                          key={mode}
                          type="button"
                          onClick={() => {
                            setBlockMode(mode)
                            setDragging(undefined)
                            setTarget(undefined)
                            setSelectedRow(undefined)
                            setSelectedBlock(undefined)
                            setTab('content')
                          }}
                        >
                          {mode === 'edit' ? 'Edit content' : 'Rearrange content'}
                          <span aria-hidden="true">›</span>
                        </button>
                      ))}
                      <label className={styles.sizeControl}>
                        Sidebar size
                        <select
                          aria-label="Sidebar size"
                          value={sidebarSize}
                          onChange={(event) =>
                            setSidebarSize(event.target.value as 'standard' | 'large')
                          }
                        >
                          <option value="standard">Standard</option>
                          <option value="large">Large</option>
                        </select>
                      </label>
                      <button
                        className={styles.fieldLink}
                        type="button"
                        onClick={() => setTab('revisions')}
                      >
                        Revisions <span aria-hidden="true">›</span>
                      </button>
                    </nav>
                  )}
                  {!ready && <p role="status">Loading editable content…</p>}
                  {tab === 'content' && panelContainer && !selectedBlock && !target && (
                    <nav className={styles.blockModes} aria-label="Block mode">
                      {(['edit', 'rearrange'] as const).map((mode) => (
                        <button
                          key={mode}
                          aria-pressed={blockMode === mode}
                          onClick={() => {
                            setBlockMode(mode)
                            setDragging(undefined)
                          }}
                          type="button"
                        >
                          {mode === 'edit' ? 'Edit' : 'Rearrange'}
                        </button>
                      ))}
                    </nav>
                  )}
                  {tab === 'content' && (
                    <div key={viewKey} className={styles.drawerView}>
                      {field && field.type !== 'array' && target && (
                        <section aria-label="Selected content">
                          <h3>{field.type === 'upload' ? 'Image' : 'Text'}</h3>
                          <small className={styles.path}>
                            {session && fieldLabel(target.path, session)}
                          </small>
                          {(field.type === 'text' || field.type === 'textarea') && (
                            <>
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
                              <button
                                className={styles.restoreText}
                                disabled={
                                  busy || needsSync || !Object.hasOwn(session.changes, target.path)
                                }
                                onClick={() => stage(target, field.value)}
                                type="button"
                              >
                                Restore text
                              </button>
                            </>
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
                          {field.type === 'richText' && session && (
                            <RichTextSidebar
                              adminRoute={adminRoute}
                              documentInfo={session.owner}
                              path={target.path}
                              value={value}
                              disabled={busy || needsSync}
                              onChange={(next) => stage(target, next)}
                            />
                          )}
                        </section>
                      )}
                      {Object.entries(sessions).flatMap(([key, session]) =>
                        Object.entries(session.snapshot.fields).map(([path, field]) =>
                          field.type === 'array' &&
                          !selectedRow &&
                          ((target?.key === key && target.path === path) ||
                            (!target &&
                              selectedBlock?.key === key &&
                              blockPath &&
                              path.startsWith(`${blockPath}.`))) ? (
                            <ArrayEditor
                              key={`${key}:${path}`}
                              field={field}
                              value={(session.changes[path] ?? field.value) as ArrayRow[]}
                              disabled={busy || needsSync}
                              onChange={(rows) => stage({ key, path }, rows)}
                              onSelectRow={(id) => {
                                const index = field.value.findIndex(
                                  (row) => 'id' in row && row.id === id,
                                )
                                if (index >= 0) setSelectedRow(`${path}.${index}`)
                              }}
                            />
                          ) : null,
                        ),
                      )}
                      {!target && selectedBlock && blockPath && blockFields.length > 0 && (
                        <section aria-label="Block fields">
                          {blockFields.map(([path]) => (
                            <button
                              className={styles.fieldLink}
                              key={path}
                              type="button"
                              disabled={busy || needsSync}
                              onClick={() => setTarget({ key: selectedBlock.key, path })}
                            >
                              {humanize(
                                path
                                  .slice((selectedRow || blockPath).length + 1)
                                  .replace(/\.(\d+)\./g, (_, index) => ` ${Number(index) + 1} `)
                                  .replaceAll('.', ' · '),
                              )}{' '}
                              <span aria-hidden="true">›</span>
                            </button>
                          ))}
                        </section>
                      )}
                      {!selectedBlock &&
                        !target &&
                        Object.values(sessions).some(
                          (session) => Object.keys(session.snapshot.orders).length > 0,
                        ) && (
                          <section aria-label="Blocks">
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
                                          if (
                                            blockMode === 'rearrange' &&
                                            dragging?.key === key &&
                                            dragging.path === path
                                          ) {
                                            event.preventDefault()
                                          }
                                        }}
                                        onDrop={(event) => {
                                          event.preventDefault()
                                          if (
                                            blockMode === 'rearrange' &&
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
                                        {blockMode === 'rearrange' && (
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
                                        )}
                                        {blockMode === 'edit' ? (
                                          <button
                                            className={styles.blockSelect}
                                            title={humanize(
                                              rows.find((row) => row.id === id)?.label || 'Block',
                                            )}
                                            aria-label={`Edit ${humanize(rows.find((row) => row.id === id)?.label || 'Block')}`}
                                            disabled={busy || needsSync}
                                            onClick={() => selectBlock(key, path, id)}
                                            type="button"
                                          >
                                            {humanize(
                                              rows.find((row) => row.id === id)?.label || 'Block',
                                            )}
                                            <span aria-hidden="true"> ›</span>
                                          </button>
                                        ) : (
                                          <span
                                            className={styles.blockLabel}
                                            title={humanize(
                                              rows.find((row) => row.id === id)?.label || 'Block',
                                            )}
                                          >
                                            {humanize(
                                              rows.find((row) => row.id === id)?.label || 'Block',
                                            )}
                                          </span>
                                        )}
                                        {blockMode === 'rearrange' && (
                                          <>
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
                                              disabled={
                                                busy || needsSync || index === ids.length - 1
                                              }
                                              onClick={() => move(key, path, id, index + 1)}
                                              type="button"
                                            >
                                              ↓
                                            </button>
                                          </>
                                        )}
                                      </li>
                                    ))}
                                  </ol>
                                )
                              }),
                            )}
                          </section>
                        )}
                    </div>
                  )}
                  <details
                    className={styles.changes}
                    aria-label="Pending changes"
                    hidden={Boolean(panelContainer) && tab !== 'changes'}
                    open={tab === 'changes' || undefined}
                  >
                    <summary>
                      Changes <span>{count}</span>
                    </summary>
                    {count === 0 && <p>No pending changes.</p>}
                    <ul className={styles.pending}>
                      {Object.entries(sessions).flatMap(([key, session]) => [
                        ...Object.keys(session.changes).map((path) => (
                          <li key={`${key}:${path}`}>
                            <button
                              onClick={() => {
                                setTab('content')
                                selectField(key, path)
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
                              onClick={() =>
                                stage({ key, path }, session.snapshot.fields[path].value)
                              }
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
                              onClick={() => {
                                rememberEdit()
                                setSessions((previous) => {
                                  const orders = { ...previous[key].orders }
                                  delete orders[path]
                                  return {
                                    ...previous,
                                    [key]: { ...previous[key], orders },
                                  }
                                })
                              }}
                              type="button"
                            >
                              Undo
                            </button>
                          </li>
                        )),
                      ])}
                    </ul>
                  </details>
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
                  {!panelContainer && (
                    <p role="status">
                      {busy && ready ? (refreshing ? 'Updating preview…' : 'Saving…') : status}
                    </p>
                  )}
                </>
              )}
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
                  Save draft
                  {count > 0 && !actionsContainer && <span className={styles.count}>{count}</span>}
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
      {picker && !panelContainer && (
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
    </>
  )
}
