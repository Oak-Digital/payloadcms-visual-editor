'use client'

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal, flushSync } from 'react-dom'

import type { Annotation, PayloadCMSDocument } from '../../types.js'

import { validPageRecovery } from '../../utils/recovery-validation.js'
import {
  clearRecovery,
  readRecovery,
  recoveryValue,
  writeRecovery,
  type RecoveryRecord,
} from '../../utils/recovery.js'
import { usePreviewRefresh } from '../../hooks/use-preview-refresh.js'
import {
  type ArrayRow,
  type ArrangeField,
  type ArrangeSnapshot,
  type LayoutSource,
  remapArrangePath,
} from '../../utils/arrange.js'
import { documentKey, fieldDocument } from '../../utils/field-target.js'
import { type MediaChoice, MediaPicker } from '../media-picker/index.js'
import { imageFieldAt, previewImages } from '../media-picker/preview.js'
import { EditorRequestError } from '../../utils/editor-error.js'
import { PublishReview, type PublishReviewItem } from '../publish-review/index.js'
import { RevisionHistory } from '../revision-history/index.js'
import { RichTextOverlay } from '../rich-text-editor/overlay.js'
import { RichTextSidebar } from '../rich-text-editor/sidebar.js'
import { EditorIcon } from '../workspace/icons.js'
import { imagePlaceholder } from '../../utils/image-placeholder.js'
import { SchemaFields } from '../schema-fields/index.js'
import { ScalarField, scalarFieldTypes } from '../schema-fields/scalar-field.js'
import { findFieldLayout, fieldLayoutTrail } from '../../utils/field-layout.js'
import styles from './styles.module.scss'
import { RecoveryPanel } from './recovery-panel.js'
import { ArrayEditor } from './array-editor.js'
import { CanvasBlockControls } from './canvas-block-controls.js'
import { BlockPlacement } from './block-placement.js'
import { createDraftBlockPreviews } from './draft-block-preview.js'
import { createCanvasTextEditor } from './canvas-text.js'

type Session = {
  additions: Record<
    string,
    { id: string; blockType: string; sourceId?: string; layoutSource?: LayoutSource }[]
  >
  changes: Record<string, unknown>
  media: Record<string, MediaChoice>
  orders: Record<string, string[]>
  owner: PayloadCMSDocument
  snapshot: ArrangeSnapshot
}
function isRecoverySession(value: unknown): value is Session {
  return validPageRecovery(value)
}
function expandedOrders(session: Session) {
  return Object.fromEntries(
    Object.entries(session.snapshot.orders).map(([path, rows]) => [
      path,
      [
        ...rows,
        ...(session.additions[path] ?? []).map((addition) => ({
          id: addition.id,
          blockType: addition.blockType,
          label:
            session.snapshot.blockTypes?.[path]?.find((type) => type.slug === addition.blockType)
              ?.label || addition.blockType,
        })),
      ],
    ]),
  )
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
  onComment,
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
    badge: string,
    error: string,
  ) => void
  headerContainer?: HTMLElement
  historyContainer?: HTMLElement
  onReveal?: () => void
  onHome?: () => void
  onComment?: (element: HTMLElement, label: string) => void
  panelContainer?: HTMLElement
}) {
  const [presentation, setPresentation] = useState<
    Record<string, Record<string, { hidden?: boolean }>>
  >({})
  const [previewEpoch, setPreviewEpoch] = useState(0)
  useEffect(() => {
    const rendered = () => setPreviewEpoch((value) => value + 1)
    window.addEventListener('payload:preview-rendered', rendered)
    return () => window.removeEventListener('payload:preview-rendered', rendered)
  }, [])
  const [tab, setTab] = useState<'menu' | 'content' | 'revisions' | 'changes' | 'publish'>(
    panelContainer ? 'content' : 'menu',
  )
  const publishReturnTab = useRef<Exclude<typeof tab, 'publish'>>(tab === 'publish' ? 'content' : tab)
  const [reviewItems, setReviewItems] = useState<PublishReviewItem[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewFailed, setReviewFailed] = useState(false)
  const reviewSessions = useRef<Record<string, Session>>({})
  const [blockMode, setBlockMode] = useState<'edit' | 'rearrange'>('edit')
  const [adding, setAdding] = useState<Target & { blockType?: string; label?: string }>()
  const placedBlock = useRef<{ key: string; path: string; id: string } | undefined>(undefined)
  const [revisionRefresh, setRevisionRefresh] = useState(0)
  const [historical, setHistorical] = useState<PayloadCMSDocument>()
  const revisionRequest = useRef<{ cancel: () => void } | undefined>(undefined)
  const [historyOwnerKey, setHistoryOwnerKey] = useState<string>()
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [recoveries, setRecoveries] = useState<
    Record<string, { record: RecoveryRecord<Session>; conflict: boolean }>
  >({})
  const [collapsedRecoveries, setCollapsedRecoveries] = useState<Record<string, string>>({})
  const hasRecoveries = Object.keys(recoveries).length > 0
  const unreadRecovery = useRef(new Set<string>())
  const [recoveryNotice, setRecoveryNotice] = useState('')
  const [undoStack, setUndoStack] = useState<Record<string, Session>[]>([])
  const [redoStack, setRedoStack] = useState<Record<string, Session>[]>([])
  function rememberEdit() {
    setUndoStack((previous) => [...previous.slice(-59), sessions])
    setRedoStack([])
  }
  const [target, setTarget] = useState<Target>()
  const [richTextAnchor, setRichTextAnchor] = useState<HTMLElement>()
  const [cachedRichText, setCachedRichText] = useState<Target & { anchor: HTMLElement }>()
  const [hovered, setHovered] = useState<{ id?: string } & Target>()
  const returnToCanvas = useRef<HTMLElement | undefined>(undefined)
  const fieldId = useId()
  const fieldButtons = useRef(new Map<string, HTMLButtonElement>())
  const returnToField = useRef<string | undefined>(undefined)
  const [selectedRow, setSelectedRow] = useState<string>()
  const [selectedBlock, setSelectedBlock] = useState<{
    key: string
    path: string
    id: string
  }>()
  const [previewRequest, setPreviewRequest] = useState(0)
  useEffect(() => {
    const request = () => setPreviewRequest((value) => value + 1)
    window.addEventListener('payload:preview-request', request)
    return () => window.removeEventListener('payload:preview-request', request)
  }, [])
  const [layoutView, setLayoutView] = useState<{
    key: string
    label: string
    target?: Target
    block?: { key: string; path: string; id: string }
  }>()
  const heading = useRef<HTMLHeadingElement>(null)
  const selectedSession = selectedBlock && sessions[selectedBlock.key]
  const selectedIndex =
    selectedBlock &&
    (selectedSession && expandedOrders(selectedSession)[selectedBlock.path])?.findIndex(
      (row) => row.id === selectedBlock.id,
    )
  const blockPath =
    selectedBlock && selectedIndex !== undefined && selectedIndex >= 0
      ? `${selectedBlock.path}.${selectedIndex}`
      : undefined
  const blockLabel =
    selectedBlock && selectedIndex !== undefined
      ? (selectedSession && expandedOrders(selectedSession)[selectedBlock.path])?.[selectedIndex]
          ?.label
      : undefined
  useEffect(() => {
    if (!selectedBlock || committed.current.has(selectedBlock.key)) return
    const session = sessions[selectedBlock.key]
    const ids =
      session?.orders[selectedBlock.path] ??
      session?.snapshot.orders[selectedBlock.path]?.map((row) => row.id) ??
      []
    if (!ids.includes(selectedBlock.id)) {
      setSelectedBlock(undefined)
      setSelectedRow(undefined)
      setTarget(undefined)
    }
  }, [sessions, selectedBlock])
  const viewKey = target
    ? `${target.key}:${target.path}`
    : selectedRow
      ? selectedRow
      : selectedBlock
        ? `${selectedBlock.key}:${selectedBlock.id}`
        : adding
          ? `add:${adding.key}:${adding.path}:${adding.blockType || ''}`
          : (layoutView?.key ?? 'blocks')
  function selectOwner(key: string) {
    if (key === documentKey(documentInfo)) setLayoutView(undefined)
    else if (layoutView?.key !== key)
      setLayoutView({
        key,
        label: sessions[key]?.snapshot.label || 'Shared layout',
        target,
        block: selectedBlock,
      })
  }
  function scrollToBlock(key: string, path: string, id: string) {
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
      if (block) return true
    }
    return false
  }
  function selectBlock(key: string, path: string, id: string) {
    selectOwner(key)
    onReveal?.()
    scrollToBlock(key, path, id)
    setAdding(undefined)
    setSelectedRow(undefined)
    setSelectedBlock({ key, path, id })
    setTarget(undefined)
    setTab('content')
    setBlockMode('edit')
  }
  function selectField(key: string, path: string) {
    setAdding(undefined)
    setRichTextAnchor(undefined)
    selectOwner(key)
    onReveal?.()
    const order = Object.entries(expandedOrders(sessions[key]))
      .filter(([orderPath]) => path.startsWith(`${orderPath}.`))
      .sort(([a], [b]) => b.length - a.length)[0]
    const row = order?.[1][Number(path.slice(order[0].length + 1).split('.')[0])]
    setSelectedBlock(order && row ? { key, path: order[0], id: row.id } : undefined)
    const trail = fieldLayoutTrail(sessions[key].snapshot.layout ?? [], path)
    setSelectedRow(
      trail
        .filter(
          (node) =>
            node.type === 'item' && node.path !== `${order?.[0]}.${order?.[1].indexOf(row!)}`,
        )
        .at(-1)?.path,
    )
    setTarget({ key, path })
    setBlockMode('edit')
    setTab('content')
  }
  const blockLayout =
    blockPath && selectedSession?.snapshot.layout
      ? findFieldLayout(selectedSession.snapshot.layout, blockPath)
      : undefined
  const layoutViewNode =
    selectedRow && blockLayout ? findFieldLayout([blockLayout], selectedRow) : blockLayout
  const layoutNodes = layoutViewNode?.children
  const inlineFields = Boolean(
    panelContainer &&
      selectedBlock &&
      layoutNodes?.length &&
      (!target ||
        (target.key === selectedBlock.key &&
          Boolean(blockLayout && findFieldLayout([blockLayout], target.path)))),
  )
  const drawerKey =
    inlineFields && selectedBlock
      ? `${selectedBlock.key}:${selectedBlock.id}:${selectedRow || ''}`
      : viewKey
  function closeField() {
    returnToCanvas.current = richTextAnchor
    setRichTextAnchor(undefined)
    if (inlineFields && target) returnToField.current = target.path
    setTarget(undefined)
  }
  useEffect(() => {
    if (!active || richTextAnchor || document.activeElement?.hasAttribute('data-arrange-inline'))
      return
    if (returnToCanvas.current?.isConnected) {
      returnToCanvas.current.focus({ preventScroll: true })
      returnToCanvas.current = undefined
      returnToField.current = undefined
      return
    }
    const path = returnToField.current || (inlineFields ? target?.path : undefined)
    const button = path ? fieldButtons.current.get(path) : undefined
    returnToField.current = undefined
    if (button) {
      button.focus({ preventScroll: true })
      button.scrollIntoView({ behavior: 'instant', block: 'nearest' })
    } else {
      const control =
        path &&
        [...(panelContainer ?? document).querySelectorAll<HTMLElement>('[data-field-path]')]
          .find((element) => element.dataset.fieldPath === path)
          ?.querySelector<HTMLElement>('input, textarea, select')
      if (control) control.focus({ preventScroll: true })
      else heading.current?.focus({ preventScroll: true })
    }
  }, [viewKey, active, tab, inlineFields, target?.path, richTextAnchor])
  useEffect(() => {
    if (!active || tab !== 'content' || !hovered) return
    const elements = hovered.id
      ? [...document.querySelectorAll<HTMLElement>('[data-payload-block-list]')]
          .filter(
            (list) =>
              list.dataset.payloadBlockList === hovered.path &&
              documentKey(fieldDocument(list, documentInfo)) === hovered.key,
          )
          .flatMap((list) =>
            [...list.children].filter(
              (child) => (child as HTMLElement).dataset.payloadBlockId === hovered.id,
            ),
          )
      : [...document.querySelectorAll<HTMLElement>('[data-payload-path]')].filter(
          (element) =>
            element.dataset.payloadPath === hovered.path &&
            documentKey(fieldDocument(element, documentInfo)) === hovered.key,
        )
    elements.forEach((element) => element.setAttribute('data-arrange-hovered', ''))
    return () => elements.forEach((element) => element.removeAttribute('data-arrange-hovered'))
  }, [hovered, active, tab, documentInfo, previewEpoch])
  const [picker, setPicker] = useState<Target>()
  const pickerOrders = useMemo(() => {
    const session = picker && sessions[picker.key]
    return session
      ? Object.entries(session.additions).map(([path, additions]) => ({
          path,
          additions,
          ids: session.orders[path] ?? session.snapshot.orders[path].map((row) => row.id),
        }))
      : undefined
  }, [picker?.key, sessions])
  const [pickerSelection, setPickerSelection] = useState<MediaChoice>()
  const blockLists = Object.entries(sessions)
    .filter(([key]) => key === (layoutView?.key ?? documentKey(documentInfo)))
    .flatMap(([key, session]) =>
      Object.entries(expandedOrders(session)).map(([path, rows]) => ({
        key,
        path,
        label: findFieldLayout(session.snapshot.layout ?? [], path)?.label || humanize(path),
        full:
          (session.orders[path] ?? rows).length >=
          (session.snapshot.blockLimits?.[path]?.max ?? Infinity),
      })),
    )
  const showBlockActions =
    tab === 'content' &&
    !picker &&
    !adding &&
    selectedBlock &&
    !selectedRow &&
    (!target || inlineFields)
  const showAddActions =
    tab === 'content' &&
    !picker &&
    !adding &&
    !selectedBlock &&
    !target &&
    blockMode === 'edit' &&
    blockLists.length > 0
  useEffect(() => {
    if (pickerSelection && panelContainer) heading.current?.focus({ preventScroll: true })
  }, [pickerSelection, panelContainer])
  const [sidebarSize, setSidebarSize] = useState<'standard' | 'large'>('standard')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'save' | 'publish' | 'refresh' | 'add' | 'load'>(
    'save',
  )
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
  const hasDrafts = Object.values(sessions).some(
    (session) => session.snapshot.publicationStatus !== 'published',
  )
  const publicationError = reviewItems.find((item) => item.status === 'failed')?.error
  const footerError = error || publicationError || recoveryNotice
  const badge =
    !ready && !error
      ? 'Loading…'
      : busy
        ? !ready || operation === 'load'
          ? 'Loading…'
          : refreshing || operation === 'refresh'
            ? reviewLoading
              ? 'Reviewing…'
              : 'Updating preview…'
            : operation === 'add'
              ? 'Adding block…'
              : operation === 'publish'
                ? 'Publishing…'
                : 'Saving…'
        : needsSync
          ? 'Preview failed'
          : publicationError || (error && operation === 'publish')
            ? 'Publish failed'
            : error
              ? operation === 'save'
                ? 'Save failed'
                : 'Error'
              : hasRecoveries
                ? 'Restore edits'
                : count > 0
                  ? 'Unsaved'
                  : hasDrafts
                    ? 'Draft saved'
                    : 'Published'
  useEffect(() => {
    onPendingChange?.(
      count > 0 || needsSync || Object.keys(recoveries).length > 0,
      busy,
      count,
      busy
        ? !ready || operation === 'load'
          ? 'Loading content…'
          : refreshing || operation === 'refresh'
            ? 'Updating preview…'
            : operation === 'add'
              ? 'Adding block…'
              : operation === 'publish'
                ? 'Publishing…'
                : 'Saving draft…'
        : hasRecoveries
          ? 'Review stored edits before saving.'
          : status,
      Object.values(sessions).reduce(
        (total, session) =>
          total +
          Object.entries(session.snapshot.orders).reduce(
            (sum, [path, rows]) => sum + (session.orders[path]?.length ?? rows.length),
            0,
          ),
        0,
      ),
      badge,
      footerError,
    )
  }, [
    badge,
    footerError,
    count,
    needsSync,
    busy,
    status,
    sessions,
    recoveries,
    hasRecoveries,
    onPendingChange,
    ready,
    refreshing,
    operation,
  ])

  function goBack() {
    if (busy) return
    if (tab === 'publish') {
      setTab(publishReturnTab.current)
      return
    }
    if (pickerSelection) setPickerSelection(undefined)
    else if (picker) setPicker(undefined)
    else if (adding)
      setAdding(adding.blockType ? { key: adding.key, path: adding.path } : undefined)
    else if (tab === 'revisions' || tab === 'changes' || tab === 'menu') {
      if (onHome) onHome()
      else setTab(panelContainer ? 'content' : 'menu')
    } else if (target) closeField()
    else if (selectedRow) {
      const trail = fieldLayoutTrail(blockLayout ? [blockLayout] : [], selectedRow)
      setSelectedRow(
        trail
          .slice(1, -1)
          .filter((node) => ['array', 'blocks', 'item'].includes(node.type))
          .at(-1)?.path,
      )
    } else if (selectedBlock) setSelectedBlock(undefined)
    else if (layoutView) {
      setTarget(layoutView.target)
      setSelectedBlock(layoutView.block)
      setLayoutView(undefined)
    } else if (onHome) onHome()
    else setTab(panelContainer ? 'content' : 'menu')
  }
  useEffect(() => {
    if (!active || !adding) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (!busy) setAdding(undefined)
    }
    const documents = new Set([document, panelContainer?.ownerDocument ?? document])
    documents.forEach((doc) => doc.addEventListener('keydown', cancel, true))
    return () => documents.forEach((doc) => doc.removeEventListener('keydown', cancel, true))
  }, [active, adding, busy, panelContainer])
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
        setPickerSelection(undefined)
        setAdding(undefined)
        setTarget(undefined)
        setSelectedBlock(undefined)
        setSelectedRow(undefined)
        setBlockMode('edit')
        setTab(event.data.view === 'blocks' ? 'content' : event.data.view)
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [
    panelContainer,
    picker,
    pickerSelection,
    adding,
    tab,
    target,
    selectedRow,
    selectedBlock,
    onHome,
  ])
  const session = target && sessions[target.key]
  const selectedField = target && session?.snapshot.fields[target.path]
  const field =
    target && (presentation[target.key]?.[target.path]?.hidden ?? selectedField?.hidden)
      ? undefined
      : selectedField
  const value =
    target &&
    session &&
    (Object.hasOwn(session.changes, target.path) ? session.changes[target.path] : field?.value)
  const imagePreview =
    field?.type === 'upload' && target && session
      ? session.media[target.path]?.url ||
        (typeof document !== 'undefined'
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-payload-type="upload"]'))
              .filter(
                (element) =>
                  element.dataset.payloadPath === target.path &&
                  documentKey(fieldDocument(element, documentInfo)) === target.key,
              )
              .map((element) =>
                element instanceof HTMLImageElement ? element : element.querySelector('img'),
              )
              .find((image) => image?.getAttribute('src'))
              ?.getAttribute('src')
          : undefined)
      : undefined

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
        throw new EditorRequestError(result.error || 'Unable to load editor', result.fieldErrors)
      }
      return result
    },
    [apiRoute],
  )

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(async () => {
      for (const [key, session] of Object.entries(sessions)) {
        if (!Object.values(session.snapshot.fields).some((field) => field.conditional)) continue
        if (!Object.keys(session.changes).length && !Object.keys(session.additions).length) {
          if (!cancelled)
            setPresentation((previous) => ({ ...previous, [key]: session.snapshot.fields }))
          continue
        }
        try {
          const result = await request(session.owner, {
            action: 'fields',
            revision: session.snapshot.revision,
            paths: Object.keys(session.snapshot.fields),
            orderPaths: Object.keys(session.snapshot.orders),
            changes: Object.entries(session.changes).map(([path, value]) => ({ path, value })),
            orders: Object.entries(session.orders).map(([path, ids]) => ({
              path,
              ids,
              additions: session.additions[path] ?? [],
            })),
          })
          if (!cancelled)
            setPresentation((previous) => ({ ...previous, [key]: result.presentation }))
        } catch (error) {
          if (!cancelled)
            setError(error instanceof Error ? error.message : 'Unable to update field visibility')
        }
      }
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
    }
  }, [sessions, request])

  useEffect(() => {
    if (target && presentation[target.key]?.[target.path]?.hidden) setTarget(undefined)
  }, [presentation, target])

  async function openLayout() {
    if (!target || field?.type !== 'relationship' || typeof value !== 'string' || busy) return
    const owner = {
      collection: field.collection,
      id: value,
      locale: session?.owner.locale,
      hasDrafts: true,
    }
    const key = documentKey(owner)
    setOperation('load')
    setBusy(true)
    setError('')
    try {
      let source = sessions[key]
      if (!source) {
        const snapshot: ArrangeSnapshot = await request(owner, {
          action: 'read',
          paths: [],
          orderPaths: [field.layoutPath],
        })
        source = { owner, snapshot, additions: {}, changes: {}, media: {}, orders: {} }
        setSessions((previous) => ({ ...previous, [key]: source }))
        try {
          const recovered = readRecovery(
            window.localStorage,
            recoveryScope(source),
            snapshot.revision,
            isRecoverySession,
          )
          if (recovered.status === 'available' && documentKey(recovered.record.value.owner) === key)
            setRecoveries((previous) => ({ ...previous, [key]: recovered }))
          else if (recovered.status !== 'empty') {
            unreadRecovery.current.add(key)
            setRecoveryNotice('Stored edits could not be read. Save your draft before leaving.')
          }
        } catch {
          unreadRecovery.current.add(key)
          setRecoveryNotice('Browser recovery is unavailable. Save your draft before leaving.')
        }
      }
      setLayoutView({
        key,
        label: source.snapshot.label || 'Shared layout',
        target,
        block: selectedBlock,
      })
      setTarget(undefined)
      setSelectedBlock(undefined)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to open layout')
    } finally {
      setBusy(false)
    }
  }

  function recoveryScope(session: Session) {
    return {
      api: apiRoute,
      user: session.snapshot.recoveryUser || '',
      kind: 'page' as const,
      document: documentKey(session.owner),
      locale: session.owner.locale,
    }
  }
  useEffect(() => {
    if (!ready || busy) return
    for (const [key, session] of Object.entries(sessions)) {
      if (recoveries[key] || unreadRecovery.current.has(key) || !session.snapshot.recoveryUser)
        continue
      const dirty = Object.keys(session.changes).length || Object.keys(session.orders).length
      try {
        const stored = dirty
          ? writeRecovery(
              window.localStorage,
              recoveryScope(session),
              session.snapshot.revision,
              session,
            )
          : clearRecovery(window.localStorage, recoveryScope(session))
        if (!stored)
          setRecoveryNotice('Browser recovery is unavailable. Save your draft before leaving.')
      } catch {
        setRecoveryNotice('Browser recovery is unavailable. Save your draft before leaving.')
      }
    }
  }, [sessions, recoveries, ready, busy])

  const readSession = useCallback(
    async (owner: PayloadCMSDocument, known?: ArrangeSnapshot) => {
      const key = documentKey(owner)
      const paths = new Set<string>(Object.keys(known?.fields ?? {}))
      const orderPaths = new Set<string>(Object.keys(known?.orders ?? {}))
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
      return { additions: {}, changes: {}, media: {}, orders: {}, owner, snapshot } as Session
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
      const recovered: typeof recoveries = {}
      for (const [key, session] of Object.entries(loaded)) {
        if (!session.snapshot.recoveryUser) continue
        try {
          const result = readRecovery(
            window.localStorage,
            recoveryScope(session),
            session.snapshot.revision,
            isRecoverySession,
          )
          if (result.status === 'available' && documentKey(result.record.value.owner) === key) {
            recovered[key] = result
          } else if (result.status !== 'empty') {
            unreadRecovery.current.add(key)
            setRecoveryNotice('Stored edits could not be read. Save your draft before leaving.')
          }
        } catch {
          setRecoveryNotice('Browser recovery is unavailable. Save your draft before leaving.')
        }
      }
      setRecoveries(recovered)
      if (Object.keys(recovered).length) onReveal?.()
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
    if (!active || historical) {
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
      if (busy || needsSync || adding || tab === 'publish' || blockMode === 'rearrange') {
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
      if (sessions[key].snapshot.fields[path].type === 'richText') {
        setCachedRichText({ key, path, anchor: editable as HTMLElement })
        setRichTextAnchor(editable as HTMLElement)
      }
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
    let warmup: ReturnType<typeof setTimeout> | undefined
    const warmEditor = (event: Event) => {
      if (busy || needsSync || tab !== 'content' || blockMode !== 'edit') return
      const element =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-payload-path][data-payload-type="richText"]')
          : null
      if (!element) return
      const key = documentKey(fieldDocument(element, documentInfo))
      const path = element.dataset.payloadPath!
      if (sessions[key]?.snapshot.fields[path]?.type !== 'richText') return
      clearTimeout(warmup)
      warmup = setTimeout(
        () => {
          setCachedRichText((current) =>
            current?.key === key && current.path === path
              ? current
              : { key, path, anchor: element },
          )
        },
        event.type === 'focusin' ? 0 : 120,
      )
    }
    const cancelWarmup = () => clearTimeout(warmup)
    document.addEventListener('pointerover', warmEditor)
    document.addEventListener('pointerout', cancelWarmup)
    document.addEventListener('focusin', warmEditor)
    document.addEventListener('keydown', keyboard, true)
    document.addEventListener('click', select, true)
    return () => {
      elements.forEach((element) => element.removeAttribute('data-arrange-editable'))
      focusable.forEach((element, index) =>
        tabIndexes[index] === null
          ? element.removeAttribute('tabindex')
          : element.setAttribute('tabindex', tabIndexes[index]),
      )
      clearTimeout(warmup)
      document.removeEventListener('pointerover', warmEditor)
      document.removeEventListener('pointerout', cancelWarmup)
      document.removeEventListener('focusin', warmEditor)
      document.removeEventListener('keydown', keyboard, true)
      document.removeEventListener('click', select, true)
    }
  }, [
    active,
    busy,
    needsSync,
    sessions,
    documentInfo,
    blockMode,
    tab,
    previewEpoch,
    layoutView,
    historical,
    adding,
  ])

  function undo() {
    const previous = undoStack.at(-1)
    if (!previous || busy || needsSync || historical || tab === 'publish') return
    setRedoStack((stack) => [...stack, sessions])
    setUndoStack((stack) => stack.slice(0, -1))
    setSessions(previous)
    setStatus('')
  }
  function redo() {
    const next = redoStack.at(-1)
    if (!next || busy || needsSync || historical || tab === 'publish') return
    setUndoStack((stack) => [...stack, sessions])
    setRedoStack((stack) => stack.slice(0, -1))
    setSessions(next)
    setStatus('')
  }
  useEffect(() => {
    if (!ready || refreshing || !document.querySelector('[data-payload-live-preview]')) return
    for (const session of Object.values(sessions)) {
      const dirty = Object.keys(session.changes).length || Object.keys(session.orders).length
      window.dispatchEvent(
        new CustomEvent('payload:render-preview', {
          detail: {
            owner: session.owner,
            request:
              dirty &&
              !committed.current.has(documentKey(session.owner)) &&
              !(busy && ['save', 'publish', 'refresh'].includes(operation))
                ? {
                    ...session.owner,
                    revision: session.snapshot.revision,
                    paths: Object.keys(session.snapshot.fields),
                    orderPaths: Object.keys(session.snapshot.orders),
                    changes: Object.entries(session.changes).map(([path, value]) => ({
                      path,
                      value,
                    })),
                    orders: Object.entries(session.orders).map(([path, ids]) => ({
                      path,
                      ids,
                      additions: session.additions[path] ?? [],
                    })),
                  }
                : null,
          },
        }),
      )
    }
  }, [sessions, ready, refreshing, busy, operation, previewRequest])
  const draftPreviews = useRef<ReturnType<typeof createDraftBlockPreviews> | undefined>(undefined)
  useLayoutEffect(() => {
    if (document.querySelector('[data-payload-live-preview]')) return
    draftPreviews.current = createDraftBlockPreviews(document, documentInfo)
    return () => draftPreviews.current?.destroy()
  }, [documentInfo])
  useLayoutEffect(() => {
    draftPreviews.current?.update(
      refreshing
        ? []
        : Object.values(sessions).filter(
            (session) => !committed.current.has(documentKey(session.owner)),
          ),
    )
  })
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
      enabled: active && !historical && !adding && tab !== 'publish' && blockMode === 'edit',
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
    if (!document.querySelector('[data-payload-live-preview]'))
      restore.push(previewImages(mediaAnnotations, document, documentInfo))
    for (const list of document.querySelectorAll<HTMLElement>('[data-payload-block-list]')) {
      if (list.closest('[data-payload-live-preview]')) continue
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
        const display = element.style.display
        const index = ids.indexOf(element.dataset.payloadBlockId!)
        element.style.order = String(index)
        if (index < 0) element.style.display = 'none'
        restore.push(() => {
          element.style.order = original
          element.style.display = display
        })
      }
    }
    return () => restore.reverse().forEach((undo) => undo())
  }, [active, sessions, target, documentInfo, refreshing, previewEpoch])

  useEffect(() => {
    const placed = placedBlock.current
    if (!placed || !active || busy) return
    if (selectedBlock?.id !== placed.id || scrollToBlock(placed.key, placed.path, placed.id))
      placedBlock.current = undefined
  }, [active, busy, selectedBlock, previewEpoch])

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

  const canvasLists = useMemo(
    () =>
      Object.entries(sessions).flatMap(([key, session]) =>
        Object.entries(expandedOrders(session)).map(([path, rows]) => ({
          key,
          path,
          rows: (session.orders[path] ?? rows.map((row) => row.id)).flatMap((id) => {
            const row = rows.find((row) => row.id === id)
            return row ? [{ ...row, label: humanize(row.label) }] : []
          }),
        })),
      ),
    [sessions],
  )

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

  function changeBlocks(
    key: string,
    path: string,
    ids: string[],
    additions: Session['additions'][string],
  ) {
    rememberEdit()
    setStatus('')
    setError('')
    setSessions((previous) => {
      const session = previous[key]
      const original = session.snapshot.orders[path].map((row) => row.id)
      const orders = { ...session.orders }
      const nextAdditions = { ...session.additions }
      if (same(ids, original)) delete orders[path]
      else orders[path] = ids
      if (additions.length) nextAdditions[path] = additions
      else delete nextAdditions[path]
      if (!orders[path]) delete nextAdditions[path]
      const removedPrefixes = expandedOrders(session)[path].flatMap((row, index) =>
        ids.includes(row.id) ? [] : [`${path}.${index}.`],
      )
      const changes = Object.fromEntries(
        Object.entries(session.changes).filter(
          ([fieldPath]) => !removedPrefixes.some((prefix) => fieldPath.startsWith(prefix)),
        ),
      )
      const media = Object.fromEntries(
        Object.entries(session.media).filter(
          ([fieldPath]) => !removedPrefixes.some((prefix) => fieldPath.startsWith(prefix)),
        ),
      )
      return {
        ...previous,
        [key]: { ...session, changes, media, orders, additions: nextAdditions },
      }
    })
  }

  async function addBlock(
    key: string,
    path: string,
    blockType: string,
    sourceId?: string,
    beforeId?: string | null,
  ) {
    if (busy || needsSync) return
    const session = sessions[key]
    const original = session.snapshot.orders[path].map((row) => row.id)
    const ids = session.orders[path] ?? original
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    const max = session.snapshot.blockLimits?.[path]?.max
    if (max !== undefined && ids.length >= max) return
    const destination = sourceId
      ? ids.indexOf(sourceId) + 1
      : beforeId
        ? ids.indexOf(beforeId)
        : ids.length
    if (destination < 0) return
    const additions = [
      ...(session.additions[path] ?? []),
      { id, blockType, ...(sourceId ? { sourceId } : {}) },
    ]
    const nextIds = [...ids]
    nextIds.splice(destination, 0, id)
    const orders = { ...session.orders, [path]: nextIds }
    setOperation('add')
    setBusy(true)
    setError('')
    try {
      const prepared: ArrangeSnapshot = await request(session.owner, {
        action: 'read',
        paths: [],
        orderPaths: Object.keys(session.snapshot.orders),
        orders: Object.entries(orders).map(([orderPath, ids]) => ({
          path: orderPath,
          ids,
          additions: orderPath === path ? additions : (session.additions[orderPath] ?? []),
        })),
      })
      if (prepared.revision !== session.snapshot.revision)
        throw new Error(
          'This document changed. Reload before adding blocks; your pending changes are still here.',
        )
      const changes = { ...session.changes }
      const media = { ...session.media }
      if (sourceId) {
        const sourceIndex = expandedOrders(session)[path].findIndex((row) => row.id === sourceId)
        const targetIndex = session.snapshot.orders[path].length + additions.length - 1
        const prefix = `${path}.${sourceIndex}.`
        const targetPrefix = `${path}.${targetIndex}.`
        for (const [fieldPath, field] of Object.entries(session.snapshot.fields)) {
          if (!fieldPath.startsWith(prefix)) continue
          const targetPath = targetPrefix + fieldPath.slice(prefix.length)
          const targetField = prepared.fields[targetPath]
          if (!targetField) continue
          let value = structuredClone(
            Object.hasOwn(session.changes, fieldPath) ? session.changes[fieldPath] : field.value,
          )
          if (field.type === 'array' && targetField.type === 'array' && Array.isArray(value)) {
            const originalIds = field.value.map((row) => ('id' in row ? row.id : undefined))
            value = value.map((row: ArrayRow) => {
              if (!('id' in row)) return row
              const mapped = targetField.value[originalIds.indexOf(row.id)]
              if (!mapped || !('id' in mapped)) throw new Error('Unable to duplicate nested rows')
              return { id: mapped.id }
            })
          }
          if (!same(value, targetField.value)) changes[targetPath] = value
          if (session.media[fieldPath]) media[targetPath] = session.media[fieldPath]
        }
      }
      rememberEdit()
      setSessions((previous) => ({
        ...previous,
        [key]: {
          ...session,
          changes,
          media,
          orders,
          additions: { ...session.additions, [path]: additions },
          snapshot: {
            ...session.snapshot,
            fields: { ...session.snapshot.fields, ...prepared.fields },
            layout: prepared.layout,
          },
        },
      }))
      setStatus('')
      setAdding(undefined)
      setSelectedBlock({ key, path, id })
      placedBlock.current = { key, path, id }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to add block')
    } finally {
      setBusy(false)
    }
  }

  async function makeIndependent() {
    if (
      !target ||
      !selectedBlock ||
      !session ||
      field?.type !== 'relationship' ||
      typeof value !== 'string' ||
      busy
    )
      return
    setOperation('add')
    setBusy(true)
    setError('')
    try {
      const sourceOwner = {
        collection: field.collection,
        id: value,
        locale: session.owner.locale,
        hasDrafts: true,
      }
      const sourceKey = documentKey(sourceOwner)
      if (recoveries[sourceKey] || unreadRecovery.current.has(sourceKey))
        throw new Error('Review the shared layout recovery before copying.')
      const source: Session = sessions[sourceKey] ?? {
        owner: sourceOwner,
        snapshot: await request(sourceOwner, {
          action: 'read',
          paths: [],
          orderPaths: [field.layoutPath],
        }),
        additions: {},
        changes: {},
        orders: {},
        media: {},
      }
      if (!sessions[sourceKey]) {
        const stored = readRecovery(
          window.localStorage,
          recoveryScope(source),
          source.snapshot.revision,
          isRecoverySession,
        )
        if (stored.status !== 'empty')
          throw new Error('Open the shared layout to review stored edits before copying.')
      }
      const sourceRows = expandedOrders(source)[field.layoutPath] ?? []
      const sourceIds = source.orders[field.layoutPath] ?? sourceRows.map((row) => row.id)
      if (!sourceIds.length) throw new Error('This layout has no blocks to copy.')
      const path = selectedBlock.path
      const previousAdditions = session.additions[path] ?? []
      const copies = sourceIds.map((sourceId) => {
        const row = sourceRows.find((row) => row.id === sourceId)!
        let persisted = sourceId
        const visited = new Set<string>()
        while (!source.snapshot.orders[field.layoutPath].some((row) => row.id === persisted)) {
          if (visited.has(persisted)) throw new Error('Invalid layout copy source')
          visited.add(persisted)
          const addition = source.additions[field.layoutPath]?.find((row) => row.id === persisted)
          if (!addition?.sourceId) {
            persisted = ''
            break
          }
          persisted = addition.sourceId
        }
        return {
          id: Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join(''),
          blockType: row.blockType!,
          ...(persisted
            ? {
                layoutSource: {
                  collection: field.collection,
                  id: value,
                  path: field.layoutPath,
                  rowId: persisted,
                  revision: source.snapshot.revision,
                },
              }
            : {}),
        }
      })
      const ids = [...(session.orders[path] ?? session.snapshot.orders[path].map((row) => row.id))]
      ids.splice(ids.indexOf(selectedBlock.id), 1, ...copies.map((copy) => copy.id))
      const additions = [...previousAdditions, ...copies]
      const orders = { ...session.orders, [path]: ids }
      const prepared: ArrangeSnapshot = await request(session.owner, {
        action: 'read',
        paths: [],
        orderPaths: Object.keys(session.snapshot.orders),
        orders: Object.entries(orders).map(([orderPath, ids]) => ({
          path: orderPath,
          ids,
          additions: orderPath === path ? additions : (session.additions[orderPath] ?? []),
        })),
      })
      if (prepared.revision !== session.snapshot.revision)
        throw new Error('This page changed. Reload before copying; pending edits are retained.')
      const removedPrefix = `${path}.${expandedOrders(session)[path].findIndex((row) => row.id === selectedBlock.id)}.`
      const changes = Object.fromEntries(
        Object.entries(session.changes).filter(([path]) => !path.startsWith(removedPrefix)),
      )
      const media = Object.fromEntries(
        Object.entries(session.media).filter(([path]) => !path.startsWith(removedPrefix)),
      )
      for (let index = 0; index < copies.length; index++) {
        const prefix = `${field.layoutPath}.${sourceRows.findIndex((row) => row.id === sourceIds[index])}.`
        const destination = `${path}.${session.snapshot.orders[path].length + previousAdditions.length + index}.`
        for (const [sourcePath, sourceField] of Object.entries(source.snapshot.fields)) {
          if (!sourcePath.startsWith(prefix)) continue
          const destinationPath = destination + sourcePath.slice(prefix.length)
          const destinationField = prepared.fields[destinationPath]
          if (!destinationField) continue
          let content = structuredClone(
            Object.hasOwn(source.changes, sourcePath)
              ? source.changes[sourcePath]
              : sourceField.value,
          )
          if (
            sourceField.type === 'array' &&
            destinationField.type === 'array' &&
            Array.isArray(content)
          ) {
            const originalIds = sourceField.value.map((row) => ('id' in row ? row.id : undefined))
            content = content.map((row: ArrayRow) => {
              if (!('id' in row)) return row
              const mapped = destinationField.value[originalIds.indexOf(row.id)]
              if (!mapped || !('id' in mapped)) throw new Error('Unable to copy nested rows')
              return { id: mapped.id }
            })
          }
          if (!same(content, destinationField.value)) changes[destinationPath] = content
          if (source.media[sourcePath]) media[destinationPath] = source.media[sourcePath]
        }
      }
      rememberEdit()
      setSessions((previous) => ({
        ...previous,
        [selectedBlock.key]: {
          ...session,
          changes,
          media,
          orders,
          additions: { ...session.additions, [path]: additions },
          snapshot: {
            ...session.snapshot,
            fields: { ...session.snapshot.fields, ...prepared.fields },
            layout: prepared.layout,
          },
        },
      }))
      setTarget(undefined)
      setSelectedBlock({ key: selectedBlock.key, path, id: copies[0].id })
      setStatus('Independent copy added.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to copy layout')
    } finally {
      setBusy(false)
    }
  }

  function removeBlock(key: string, path: string, id: string) {
    const session = sessions[key]
    const ids = session.orders[path] ?? session.snapshot.orders[path].map((row) => row.id)
    changeBlocks(
      key,
      path,
      ids.filter((candidate) => candidate !== id),
      session.additions[path] ?? [],
    )
    setSelectedBlock(undefined)
    setSelectedRow(undefined)
    setTarget(undefined)
  }

  async function syncPreview() {
    // Flush cleanup before React touches the same text, image and order attributes.
    flushSync(() => setRefreshing(true))
    try {
      await refreshPreview()
      const loaded = await Promise.all(
        [...committed.current].map(
          async (key) =>
            [key, await readSession(sessions[key].owner, sessions[key].snapshot)] as const,
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

  useEffect(() => {
    const receive = async (event: MessageEvent) => {
      if (
        event.source !== window.parent ||
        event.origin !== window.location.origin ||
        event.data?.type !== 'visual-editor:navigation-action'
      )
        return
      const { action, requestId } = event.data
      let success = false
      if (action === 'save') success = await submit('save')
      else if (action === 'discard' && !busy && !saving.current) {
        try {
          success = Object.values(sessions).every(
            (s) => !s.snapshot.recoveryUser || clearRecovery(window.localStorage, recoveryScope(s)),
          )
          if (success) {
            setRecoveries({})
            setSessions((all) =>
              Object.fromEntries(
                Object.entries(all).map(([key, s]) => [
                  key,
                  { ...s, changes: {}, orders: {}, additions: {}, media: {} },
                ]),
              ),
            )
            setUndoStack([])
            setRedoStack([])
          }
        } catch {
          success = false
        }
      }
      window.parent.postMessage(
        { type: 'visual-editor:navigation-result', requestId, success },
        window.location.origin,
      )
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [sessions, recoveries, busy, needsSync, count])

  const returnFromRevision = useCallback((owner: PayloadCMSDocument) => {
    revisionRequest.current?.cancel()
    window.dispatchEvent(
      new CustomEvent('payload:render-revision', { detail: { owner, versionId: null } }),
    )
    setHistorical(undefined)
  }, [])

  async function previewRevision(owner: PayloadCMSDocument, versionId: string): Promise<string> {
    if (!document.querySelector('[data-payload-live-preview]'))
      throw new Error('This host does not support revision previews')
    revisionRequest.current?.cancel()
    setHistorical(owner)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => finish(new Error('Revision preview timed out. Try again.')),
        30000,
      )
      const finish = (error?: Error, revision?: string) => {
        clearTimeout(timer)
        window.removeEventListener('payload:revision-result', receive)
        revisionRequest.current = undefined
        if (error) {
          window.dispatchEvent(
            new CustomEvent('payload:render-revision', { detail: { owner, versionId: null } }),
          )
          setHistorical(undefined)
          reject(error)
        } else resolve(revision!)
      }
      const receive = (event: Event) => {
        if (!(event instanceof CustomEvent)) return
        const result = event.detail
        if (
          result?.owner?.id !== owner.id ||
          result.owner.collection !== owner.collection ||
          result.versionId !== versionId
        )
          return
        if (result.error) finish(new Error(result.error))
        else if (typeof result.revision === 'string') finish(undefined, result.revision)
      }
      revisionRequest.current = { cancel: () => finish(new Error('Revision preview closed')) }
      window.addEventListener('payload:revision-result', receive)
      window.dispatchEvent(
        new CustomEvent('payload:render-revision', { detail: { owner, versionId } }),
      )
    })
  }

  async function restoreRevision(owner: PayloadCMSDocument, versionId: string, revision: string) {
    if (busy || needsSync || count || Object.keys(recoveries).length)
      throw new Error('Save or discard pending edits before restoring.')
    setBusy(true)
    setOperation('refresh')
    setError('')
    try {
      const response = await fetch(`${apiRoute}/payload-visual-editor/revisions`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...owner, versionId, revision, action: 'restore' }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to restore revision')
      const key = documentKey(owner)
      committed.current.add(key)
      returnFromRevision(owner)
      setUndoStack([])
      setRedoStack([])
      const savedKey = `visual-editor-drafts:${documentKey(documentInfo)}`
      try {
        const saved = JSON.parse(sessionStorage.getItem(savedKey) || '[]')
        sessionStorage.setItem(
          savedKey,
          JSON.stringify([...new Set([...(Array.isArray(saved) ? saved : []), key])]),
        )
      } catch {
        /* Restoring succeeded; storage is optional. */
      }
      setNeedsSync(true)
      await syncPreview()
      setRevisionRefresh((value) => value + 1)
      setStatus('Revision restored as draft.')
    } catch (cause) {
      if (committed.current.size) {
        setStatus('Draft restored · Preview update failed')
        setError('The draft was restored. Retry the preview update before editing.')
      }
      throw cause
    } finally {
      setBusy(false)
    }
  }

  async function preparePublish() {
    if (saving.current || busy || needsSync || historical || Object.keys(recoveries).length) return
    onReveal?.()
    if (tab !== 'publish') publishReturnTab.current = tab
    setTab('publish')
    setPicker(undefined)
    setAdding(undefined)
    setBusy(true)
    setOperation('refresh')
    setReviewLoading(true)
    setReviewFailed(false)
    setError('')
    setReviewItems([])
    const candidates = { ...sessions }
    try {
      // Retain previously saved sources even when their last reference was removed.
      try {
        const saved: unknown = JSON.parse(
          sessionStorage.getItem(`visual-editor-drafts:${documentKey(documentInfo)}`) || '[]',
        )
        if (Array.isArray(saved))
          for (const key of saved) {
            if (typeof key !== 'string' || candidates[key]) continue
            const [collection, id, locale] = JSON.parse(key)
            if (
              typeof collection !== 'string' ||
              !['string', 'number'].includes(typeof id) ||
              (locale !== undefined && locale !== null && typeof locale !== 'string')
            )
              continue
            const owner = { collection, id, locale: locale || undefined, hasDrafts: true }
            const snapshot = await request(owner, { action: 'read', paths: [], orderPaths: [] })
            candidates[key] = { owner, snapshot, additions: {}, changes: {}, media: {}, orders: {} }
          }
      } catch (cause) {
        // A missing/inaccessible saved source must not silently disappear from the review.
        if (
          cause instanceof SyntaxError ||
          (cause instanceof DOMException && cause.name === 'SecurityError')
        ) {
          /* Optional storage may be unavailable; current sessions remain reviewable. */
        } else throw cause
      }
      const items: PublishReviewItem[] = []
      const prepared: Record<string, Session> = {}
      for (const [key, candidate] of Object.entries(candidates)) {
        const pending = !!(
          Object.keys(candidate.changes).length || Object.keys(candidate.orders).length
        )
        const paths = Object.keys(candidate.snapshot.fields)
        const orderPaths = Object.keys(candidate.snapshot.orders)
        const snapshot = pending
          ? candidate.snapshot
          : await request(candidate.owner, { action: 'read', paths, orderPaths })
        const session = { ...candidate, snapshot }
        const result = await request(session.owner, {
          action: 'review',
          paths,
          orderPaths,
          revision: snapshot.revision,
          changes: Object.entries(session.changes).map(([path, value]) => ({ path, value })),
          orders: Object.entries(session.orders).map(([path, ids]) => ({
            path,
            ids,
            additions: session.additions[path] ?? [],
          })),
        })
        if (!pending && result.published && !result.changes.length) continue
        prepared[key] = structuredClone(session)
        items.push({
          ...result,
          key,
          collection: session.owner.collection,
          locale: session.owner.locale,
          pending,
          status: 'ready',
        })
      }
      reviewSessions.current = prepared
      setReviewItems(items)
    } catch (cause) {
      setReviewFailed(true)
      setError(cause instanceof Error ? cause.message : 'Unable to prepare publish review')
    } finally {
      setReviewLoading(false)
      setBusy(false)
    }
  }

  async function submit(action: 'publish' | 'save'): Promise<boolean> {
    if (saving.current || busy || needsSync || historical) {
      return false
    }
    if (hasRecoveries) {
      setCollapsedRecoveries({})
      setTab('content')
      setPicker(undefined)
      onReveal?.()
      return false
    }
    if (
      action === 'publish' &&
      (tab !== 'publish' ||
        reviewFailed ||
        !reviewItems.some((item) => item.status !== 'published'))
    )
      return false
    let success = false
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
    let activeKey: string | undefined
    try {
      for (const [key, session] of Object.entries(
        action === 'publish' ? reviewSessions.current : sessions,
      )) {
        if (
          action === 'publish' &&
          reviewItems.find((item) => item.key === key)?.status === 'published'
        )
          continue
        const changed = Object.keys(session.changes).length || Object.keys(session.orders).length
        if (!changed && action === 'save') continue
        activeKey = key
        if (
          action === 'publish' &&
          sessions[key] &&
          !same(
            [sessions[key].changes, sessions[key].orders, sessions[key].additions],
            [session.changes, session.orders, session.additions],
          )
        )
          throw new Error('Pending edits changed. Refresh the publish review.')
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
            additions: session.additions[path] ?? [],
          })),
          paths,
          revision: session.snapshot.revision,
        })
        if (session.snapshot.recoveryUser) {
          try {
            clearRecovery(window.localStorage, recoveryScope(session))
          } catch {
            /* Saving succeeded. */
          }
        }
        completed++
        if (action === 'publish')
          setReviewItems((items) =>
            items.map((item) =>
              item.key === key ? { ...item, status: 'published', error: undefined } : item,
            ),
          )
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
            path: remapArrangePath(target.path, expandedOrders(session), session.orders),
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
          [key]: {
            ...(previous[key] || session),
            snapshot: {
              ...session.snapshot,
              publicationStatus: action === 'publish' ? 'published' : 'draft',
            },
            additions: {},
            changes: {},
            media: {},
            orders: {},
          },
        }))
      }
      success = true
      setStatus(action === 'publish' ? 'All changes published.' : 'Draft saved.')
    } catch (cause) {
      if (action === 'publish') {
        setReviewFailed(true)
        setReviewItems((items) =>
          items.map((item) =>
            item.key === activeKey
              ? {
                  ...item,
                  status: 'failed',
                  error: cause instanceof Error ? cause.message : 'Publish failed',
                  fieldErrors: cause instanceof EditorRequestError ? cause.fieldErrors : [],
                }
              : item,
          ),
        )
      }
      setStatus(
        completed
          ? action === 'publish'
            ? `${completed} published · Review remaining`
            : 'Some changes saved · Retry remaining'
          : action === 'publish'
            ? 'Publish failed · Changes kept'
            : 'Save failed · Changes kept',
      )
      setError(
        action === 'publish' && activeKey
          ? ''
          : `${cause instanceof Error ? cause.message : 'Unable to save changes'}${completed ? ` ${completed} document(s) already saved. Remaining changes can be retried.` : ' Your changes are still here. Try saving again.'}`,
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
    return success
  }

  const selectedContent = field && session && field.type !== 'array' && target && (
    <section
      aria-label="Selected content"
      className={inlineFields ? styles.inlineField : undefined}
    >
      {!inlineFields && field.type !== 'relationship' && (
        <h3>{field.type === 'upload' ? 'Image' : 'Text'}</h3>
      )}
      {!inlineFields && field.type !== 'relationship' && (
        <small className={styles.path}>{session && fieldLabel(target.path, session)}</small>
      )}
      {scalarFieldTypes.includes(field.type) && (
        <ScalarField
          label={field.label || humanize(target.path.split('.').at(-1) || 'Content')}
          type={field.type}
          value={value}
          options={'options' in field ? field.options : undefined}
          hasMany={'hasMany' in field ? field.hasMany : undefined}
          disabled={busy || needsSync}
          onChange={(value) => stage(target, value)}
        />
      )}
      {field.type === 'reference' && (
        <label>
          {field.label || humanize(target.path.split('.').at(-1) || 'Content')}
          <select
            value={value == null ? '' : JSON.stringify(value)}
            disabled={busy || needsSync}
            onChange={(event) =>
              stage(target, event.target.value ? JSON.parse(event.target.value) : null)
            }
          >
            <option value="">Select content</option>
            {field.choices.map((choice) => (
              <option key={JSON.stringify(choice.value)} value={JSON.stringify(choice.value)}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {field.type === 'relationship' && (
        <div>
          <select
            aria-label="Saved layout"
            value={typeof value === 'string' ? value : ''}
            disabled={busy || needsSync}
            onChange={(event) => stage(target, event.target.value)}
          >
            <option value="" disabled>
              Select a layout
            </option>
            {field.choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
          <p>Changes to this shared layout apply wherever it is used.</p>
          <button
            type="button"
            disabled={busy || needsSync || !value}
            className={styles.fieldLink}
            onClick={openLayout}
          >
            Edit shared layout
          </button>
          <button
            type="button"
            disabled={busy || needsSync || !value}
            className={styles.fieldLink}
            onClick={makeIndependent}
          >
            Make independent
          </button>
        </div>
      )}
      {field.type === 'upload' && (
        <button
          aria-label="Replace image from preview"
          className={styles.imagePreviewButton}
          disabled={busy || needsSync}
          onClick={() => setPicker(target)}
          type="button"
        >
          <img
            className={styles.imagePreview}
            src={imagePreview || imagePlaceholder}
            alt={imagePreview ? 'Current image' : 'Choose image'}
          />
        </button>
      )}
      {field.type === 'richText' && session && !richTextAnchor && (
        <RichTextSidebar
          key={`${target.key}:${target.path}`}
          adminRoute={adminRoute}
          documentInfo={session.owner}
          path={target.path}
          schemaPath={field.schemaPath}
          value={value}
          disabled={busy || needsSync}
          onChange={(next) => stage(target, next)}
        />
      )}
      {(inlineFields ||
        field.type === 'text' ||
        field.type === 'textarea' ||
        field.type === 'upload') && (
        <div className={styles.fieldActions}>
          {field.type === 'upload' && (
            <button disabled={busy || needsSync} onClick={() => setPicker(target)} type="button">
              Replace image
            </button>
          )}
          {(field.type === 'text' || field.type === 'textarea') &&
            Object.hasOwn(session.changes, target.path) && (
              <button
                disabled={busy || needsSync}
                onClick={(event) => {
                  event.currentTarget
                    .closest('section')
                    ?.querySelector<HTMLElement>('input, textarea')
                    ?.focus()
                  stage(target, field.value)
                }}
                type="button"
              >
                Reset
              </button>
            )}
          {inlineFields && !richTextAnchor && (
            <button
              type="button"
              className={styles.doneField}
              disabled={busy || needsSync}
              onClick={closeField}
            >
              Done
            </button>
          )}
        </div>
      )}
    </section>
  )

  const renderBlockField = ([path, descriptor]: [string, ArrangeField], index: number) => {
    const label = descriptor.label || humanize(path.split('.').at(-1) || 'Content')
    const pendingValue = Object.hasOwn(selectedSession!.changes, path)
      ? selectedSession!.changes[path]
      : descriptor.value
    const summary =
      descriptor.type === 'checkbox'
        ? pendingValue
          ? 'Yes'
          : 'No'
        : descriptor.type === 'radio' || descriptor.type === 'select'
          ? descriptor.options.find((option) => option.value === pendingValue)?.label ||
            'No option selected'
          : descriptor.type === 'reference'
            ? descriptor.choices.find((choice) => same(choice.value, pendingValue))?.label ||
              'No content selected'
            : descriptor.type === 'upload'
              ? pendingValue
                ? 'Selected image'
                : 'No image selected'
              : descriptor.type === 'relationship'
                ? descriptor.choices.find((choice) => choice.id === pendingValue)?.label ||
                  'No layout selected'
                : recoveryValue(pendingValue).replace(/\s+/g, ' ')
    const expanded = Boolean(inlineFields && target?.path === path)
    const controlId = `${fieldId}-${index}`
    return (
      <div className={styles.fieldItem} key={path}>
        <button
          aria-controls={inlineFields ? controlId : undefined}
          aria-expanded={inlineFields ? expanded : undefined}
          aria-label={label}
          className={styles.fieldChoice}
          data-field-path={path}
          disabled={busy || needsSync}
          onBlur={() => setHovered(undefined)}
          onClick={() => (expanded ? closeField() : setTarget({ key: selectedBlock!.key, path }))}
          onFocus={() => setHovered({ key: selectedBlock!.key, path })}
          onMouseEnter={() => setHovered({ key: selectedBlock!.key, path })}
          onMouseLeave={() => setHovered(undefined)}
          ref={(element) => {
            if (element) {
              fieldButtons.current.set(path, element)
            } else {
              fieldButtons.current.delete(path)
            }
          }}
          title={`${humanize(blockLabel || 'Block')} / ${label} · ${summary}`}
          type="button"
        >
          <span className={styles.fieldCopy}>
            <strong>{label}</strong>
            <small>{summary}</small>
          </span>
          <span aria-hidden="true">{expanded ? '−' : '›'}</span>
        </button>
        {inlineFields && (
          <div hidden={!expanded} id={controlId}>
            {expanded && selectedContent}
          </div>
        )}
      </div>
    )
  }

  const cachedSession = cachedRichText && sessions[cachedRichText.key]
  const cachedField = cachedRichText && cachedSession?.snapshot.fields[cachedRichText.path]
  const richTextOpen = Boolean(
    active &&
      field?.type === 'richText' &&
      richTextAnchor &&
      target?.key === cachedRichText?.key &&
      target?.path === cachedRichText?.path,
  )

  return (
    <>
      {cachedRichText && cachedSession && cachedField?.type === 'richText' && (
        <RichTextOverlay
          key={`${cachedRichText.key}:${cachedRichText.path}`}
          anchor={cachedRichText.anchor}
          open={richTextOpen}
          label={cachedField.label || fieldLabel(cachedRichText.path, cachedSession)}
          portalDocument={panelContainer?.ownerDocument}
          adminRoute={adminRoute}
          documentInfo={cachedSession.owner}
          path={cachedRichText.path}
          schemaPath={cachedField.schemaPath}
          value={
            Object.hasOwn(cachedSession.changes, cachedRichText.path)
              ? cachedSession.changes[cachedRichText.path]
              : cachedField.value
          }
          disabled={busy || needsSync || !richTextOpen}
          onChange={(next) => stage(cachedRichText, next)}
          onConfirm={closeField}
        />
      )}
      <CanvasBlockControls
        active={active && tab === 'content' && !adding && !busy && !needsSync && !historical}
        epoch={previewEpoch}
        owner={documentInfo}
        lists={canvasLists}
        onMove={move}
        selected={selectedBlock}
        rearrange={blockMode === 'rearrange'}
        onEdit={selectBlock}
        onComment={onComment}
      />
      {historyContainer &&
        createPortal(
          <>
            <button
              aria-label="Undo"
              disabled={busy || needsSync || !!historical || tab === 'publish' || !undoStack.length}
              type="button"
              onClick={undo}
            >
              <EditorIcon name="undo" />
            </button>
            <button
              aria-label="Redo"
              disabled={busy || needsSync || !!historical || tab === 'publish' || !redoStack.length}
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
            data-publish-review={tab === 'publish'}
            data-inline-fields={tab === 'content' && inlineFields}
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
                    title={
                      (adding?.blockType ? `Place ${adding.label}` : undefined) ||
                      layoutViewNode?.label ||
                      (blockLabel ? humanize(blockLabel) : layoutView?.label)
                    }
                  >
                    {picker && panelContainer
                      ? pickerSelection
                        ? 'Image preview'
                        : 'Media library'
                      : tab === 'publish'
                        ? 'Review publish'
                        : tab === 'changes'
                          ? 'Changes'
                          : adding
                            ? adding.blockType
                              ? `Place ${adding.label}`
                              : 'Add block'
                            : tab === 'menu'
                              ? 'Menu'
                              : tab === 'revisions'
                                ? 'Revision history'
                                : target && !inlineFields
                                  ? field?.type === 'relationship'
                                    ? 'Saved layout'
                                    : 'Edit content'
                                  : selectedRow && layoutViewNode
                                    ? layoutViewNode.label
                                    : blockLabel
                                      ? humanize(blockLabel)
                                      : blockMode === 'edit'
                                        ? layoutView?.label || 'Page blocks'
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
              {recoveryNotice && <p role="status">{recoveryNotice}</p>}
              {Object.entries(recoveries).map(([key, recovery]) => (
                <RecoveryPanel
                  key={key}
                  collapsed={collapsedRecoveries[key] === recovery.record.savedAt}
                  onToggle={() =>
                    setCollapsedRecoveries((all) => ({
                      ...all,
                      [key]: all[key] === recovery.record.savedAt ? '' : recovery.record.savedAt,
                    }))
                  }
                  heading={
                    <>
                      <time dateTime={new Date(recovery.record.savedAt).toISOString()}>
                        {new Date(recovery.record.savedAt).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        {' · '}
                        {new Date(recovery.record.savedAt).toLocaleTimeString(undefined, {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: false,
                        })}
                      </time>
                      <p>
                        {recovery.conflict
                          ? 'Review and discard stored edits before saving. Your current changes are kept.'
                          : count > 0
                            ? 'Undo current changes to restore stored edits, or discard stored edits to keep your current changes.'
                            : 'Restore or discard these edits before saving.'}
                      </p>
                    </>
                  }
                >
                  {recovery.conflict && (
                    <p>
                      This document has newer changes. Your stored edits remain available below for
                      review.
                    </p>
                  )}
                  <details>
                    <summary>Review stored edits</summary>
                    <dl>
                      {Object.entries(recovery.record.value.changes).map(([path, value]) => (
                        <div key={path}>
                          <dt>{fieldLabel(path, recovery.record.value)}</dt>
                          <dd>{recoveryValue(value)}</dd>
                        </div>
                      ))}
                      {Object.entries(recovery.record.value.orders).map(([path, ids]) => (
                        <div key={path}>
                          <dt>Section order</dt>
                          <dd>
                            {ids
                              .map(
                                (id) =>
                                  expandedOrders(recovery.record.value)[path]?.find(
                                    (row) => row.id === id,
                                  )?.label || 'New section',
                              )
                              .join(' → ')}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                  <div className={styles.recoveryActions}>
                    <button
                      type="button"
                      disabled={busy || recovery.conflict || count > 0}
                      onClick={() => {
                        rememberEdit()
                        setSessions((all) => ({ ...all, [key]: recovery.record.value }))
                        setRecoveries((all) => {
                          const next = { ...all }
                          delete next[key]
                          return next
                        })
                      }}
                    >
                      Restore edits
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        try {
                          if (!clearRecovery(window.localStorage, recoveryScope(sessions[key]))) {
                            setRecoveryNotice('Stored edits could not be discarded.')
                            return
                          }
                          setRecoveries((all) => {
                            const next = { ...all }
                            delete next[key]
                            return next
                          })
                        } catch {
                          setRecoveryNotice('Stored edits could not be discarded.')
                        }
                      }}
                    >
                      Discard edits
                    </button>
                  </div>
                </RecoveryPanel>
              ))}

              {picker && panelContainer && (
                <MediaPicker
                  embedded
                  adminRoute={adminRoute}
                  apiRoute={apiRoute}
                  documentInfo={sessions[picker.key].owner}
                  onClose={() => {
                    setPickerSelection(undefined)
                    setPicker(undefined)
                  }}
                  onSelect={(media) => {
                    stage(picker, media.id, media)
                    setPickerSelection(undefined)
                    setPicker(undefined)
                  }}
                  selected={pickerSelection}
                  onSelectionChange={setPickerSelection}
                  path={picker.path}
                  draftOrders={pickerOrders}
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
                  {tab === 'content' && panelContainer && !selectedBlock && !target && !adding && (
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
                    <div key={drawerKey} className={styles.drawerView}>
                      {layoutView && (selectedBlock || target || adding) && (
                        <p title={layoutView.label}>Shared layout · {layoutView.label}</p>
                      )}
                      {adding?.blockType && sessions[adding.key] && (
                        <BlockPlacement
                          rows={
                            canvasLists.find(
                              (list) => list.key === adding.key && list.path === adding.path,
                            )?.rows ?? []
                          }
                          disabled={
                            busy ||
                            needsSync ||
                            Boolean(
                              blockLists.find(
                                (list) => list.key === adding.key && list.path === adding.path,
                              )?.full,
                            )
                          }
                          onPlace={(beforeId) =>
                            void addBlock(
                              adding.key,
                              adding.path,
                              adding.blockType!,
                              undefined,
                              beforeId,
                            )
                          }
                        />
                      )}
                      {adding && !adding.blockType && sessions[adding.key] && (
                        <section aria-label="Add block">
                          {(sessions[adding.key].snapshot.blockTypes?.[adding.path] ?? []).map(
                            (block) => (
                              <button
                                aria-label={`Add ${humanize(block.label)}`}
                                className={`${styles.fieldLink} ${styles.blockChoice}`}
                                disabled={busy || needsSync}
                                key={block.slug}
                                onClick={() =>
                                  setAdding({
                                    ...adding,
                                    blockType: block.slug,
                                    label: humanize(block.label),
                                  })
                                }
                                title={humanize(block.label)}
                                type="button"
                              >
                                <span className={styles.choiceLabel}>{humanize(block.label)}</span>
                                <span aria-hidden="true">›</span>
                              </button>
                            ),
                          )}
                        </section>
                      )}
                      {!inlineFields && selectedContent}
                      {(!target || inlineFields) &&
                        selectedBlock &&
                        selectedSession &&
                        blockPath &&
                        Boolean(layoutNodes?.length) && (
                          <section aria-label="Block fields" className={styles.fieldList}>
                            {layoutNodes && (
                              <SchemaFields
                                activePath={target?.path}
                                nodes={layoutNodes}
                                visible={(node) => {
                                  const field = selectedSession.snapshot.fields[node.path]
                                  return Boolean(
                                    field &&
                                      !(
                                        presentation[selectedBlock.key]?.[node.path]?.hidden ??
                                        field.hidden
                                      ),
                                  )
                                }}
                                onOpen={(node) => {
                                  setTarget(undefined)
                                  setSelectedRow(node.path)
                                }}
                                renderCollection={(node) => {
                                  const field = selectedSession.snapshot.fields[node.path]
                                  return field?.type === 'array' ? (
                                    <ArrayEditor
                                      field={field}
                                      value={
                                        (selectedSession.changes[node.path] ??
                                          field.value) as ArrayRow[]
                                      }
                                      disabled={busy || needsSync}
                                      onChange={(rows) =>
                                        stage({ key: selectedBlock.key, path: node.path }, rows)
                                      }
                                      onSelectRow={(id) => {
                                        const index = field.value.findIndex(
                                          (row) => 'id' in row && row.id === id,
                                        )
                                        if (index >= 0) setSelectedRow(`${node.path}.${index}`)
                                      }}
                                    />
                                  ) : (
                                    <button
                                      type="button"
                                      className={styles.fieldChoice}
                                      data-layout-path={node.path}
                                      onClick={() => setSelectedRow(node.path)}
                                    >
                                      <span className={styles.fieldCopy}>
                                        <strong>{node.label}</strong>
                                        <small>{node.children?.length ?? 0} items</small>
                                      </span>
                                      <span aria-hidden="true">›</span>
                                    </button>
                                  )
                                }}
                                renderField={(node) => {
                                  const descriptor = selectedSession.snapshot.fields[node.path]
                                  if (!descriptor) return null
                                  const value = Object.hasOwn(selectedSession.changes, node.path)
                                    ? selectedSession.changes[node.path]
                                    : descriptor.value
                                  if (scalarFieldTypes.includes(descriptor.type))
                                    return (
                                      <div
                                        data-field-path={node.path}
                                        onFocus={() =>
                                          setHovered({ key: selectedBlock.key, path: node.path })
                                        }
                                        onBlur={() => setHovered(undefined)}
                                      >
                                        <ScalarField
                                          label={node.label}
                                          type={descriptor.type}
                                          value={value}
                                          options={
                                            'options' in descriptor ? descriptor.options : undefined
                                          }
                                          hasMany={
                                            'hasMany' in descriptor ? descriptor.hasMany : undefined
                                          }
                                          disabled={busy || needsSync}
                                          onChange={(value) =>
                                            stage(
                                              { key: selectedBlock.key, path: node.path },
                                              value,
                                            )
                                          }
                                        />
                                      </div>
                                    )
                                  if (descriptor.type === 'reference')
                                    return (
                                      <label>
                                        {node.label}
                                        <select
                                          disabled={busy || needsSync}
                                          value={value == null ? '' : JSON.stringify(value)}
                                          onChange={(event) =>
                                            stage(
                                              { key: selectedBlock.key, path: node.path },
                                              event.target.value
                                                ? JSON.parse(event.target.value)
                                                : null,
                                            )
                                          }
                                        >
                                          <option value="">Select content</option>
                                          {descriptor.choices.map((choice) => (
                                            <option
                                              key={JSON.stringify(choice.value)}
                                              value={JSON.stringify(choice.value)}
                                            >
                                              {choice.label}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    )
                                  return renderBlockField(
                                    [node.path, descriptor],
                                    Object.keys(selectedSession.snapshot.fields).indexOf(node.path),
                                  )
                                }}
                              />
                            )}
                          </section>
                        )}
                      {!selectedBlock &&
                        !target &&
                        !adding &&
                        Object.values(sessions).some(
                          (session) => Object.keys(session.snapshot.orders).length > 0,
                        ) && (
                          <section aria-label="Blocks">
                            {layoutView && (
                              <section aria-label="Shared layout usage">
                                <p>
                                  Shared layout · Used on{' '}
                                  {sessions[layoutView.key]?.snapshot.usage?.usages.length ?? 0}{' '}
                                  pages
                                </p>
                                <ul>
                                  {sessions[layoutView.key]?.snapshot.usage?.usages.map((usage) => (
                                    <li key={`${usage.collection}:${usage.id}`}>
                                      {usage.label} · {usage.published ? 'Published' : 'Draft only'}
                                    </li>
                                  ))}
                                </ul>
                                {sessions[layoutView.key]?.snapshot.usage?.incomplete && (
                                  <p>Some usages are hidden by your access permissions.</p>
                                )}
                                {sessions[layoutView.key]?.snapshot.usage?.hasMore && (
                                  <p>More pages use this layout.</p>
                                )}
                              </section>
                            )}
                            {Object.entries(sessions)
                              .filter(
                                ([key]) => key === (layoutView?.key ?? documentKey(documentInfo)),
                              )
                              .flatMap(([key, session]) =>
                                Object.entries(expandedOrders(session)).map(([path, rows]) => {
                                  const ids = session.orders[path] ?? rows.map((row) => row.id)
                                  const list = blockLists.find(
                                    (list) => list.key === key && list.path === path,
                                  )
                                  return (
                                    <div key={`${key}:${path}`}>
                                      <ol
                                        aria-label={`${path} block order`}
                                        className={styles.blocks}
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
                                                aria-label={`Edit ${humanize(rows.find((row) => row.id === id)?.label || session.additions[path]?.find((addition) => addition.id === id)?.blockType || 'Block')}`}
                                                className={styles.blockSelect}
                                                disabled={busy || needsSync}
                                                onBlur={() => setHovered(undefined)}
                                                onClick={() => selectBlock(key, path, id)}
                                                onFocus={() => setHovered({ id, key, path })}
                                                onMouseEnter={() => setHovered({ id, key, path })}
                                                onMouseLeave={() => setHovered(undefined)}
                                                title={humanize(
                                                  rows.find((row) => row.id === id)?.label ||
                                                    'Block',
                                                )}
                                                type="button"
                                              >
                                                <span>
                                                  {humanize(
                                                    rows.find((row) => row.id === id)?.label ||
                                                      session.additions[path]?.find(
                                                        (addition) => addition.id === id,
                                                      )?.blockType ||
                                                      'Block',
                                                  )}
                                                </span>
                                                <span aria-hidden="true"> ›</span>
                                              </button>
                                            ) : (
                                              <span
                                                className={styles.blockLabel}
                                                title={humanize(
                                                  rows.find((row) => row.id === id)?.label ||
                                                    'Block',
                                                )}
                                              >
                                                {humanize(
                                                  rows.find((row) => row.id === id)?.label ||
                                                    'Block',
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
                                      {showAddActions && list && (
                                        <button
                                          className={styles.addBlock}
                                          disabled={busy || needsSync || list.full}
                                          onClick={() => setAdding({ key, path })}
                                          type="button"
                                        >
                                          <span
                                            aria-hidden="true"
                                            className={styles.addBlockIcon}
                                          />
                                          <span>
                                            {blockLists.length === 1
                                              ? 'Add block'
                                              : `Add block to ${list.label}`}
                                          </span>
                                        </button>
                                      )}
                                    </div>
                                  )
                                }),
                              )}
                          </section>
                        )}
                      {showBlockActions && (
                        <div
                          className={styles.blockActions}
                          role="group"
                          aria-label="Block actions"
                          data-feedback-toolbar
                        >
                          {showBlockActions && selectedBlock && (
                            <>
                              {selectedSession && (
                                <button
                                  className={styles.addBlock}
                                  disabled={
                                    busy ||
                                    needsSync ||
                                    (
                                      selectedSession.orders[selectedBlock.path] ??
                                      selectedSession.snapshot.orders[selectedBlock.path]
                                    ).length >=
                                      (selectedSession.snapshot.blockLimits?.[selectedBlock.path]
                                        ?.max ?? Infinity)
                                  }
                                  onClick={() => {
                                    const row = expandedOrders(selectedSession)[
                                      selectedBlock.path
                                    ].find((row) => row.id === selectedBlock.id)
                                    if (row?.blockType)
                                      void addBlock(
                                        selectedBlock.key,
                                        selectedBlock.path,
                                        row.blockType,
                                        row.id,
                                      )
                                  }}
                                  type="button"
                                >
                                  <span className={styles.blockActionIcon}>
                                    <EditorIcon name="duplicate" />
                                  </span>
                                  <span>Duplicate block</span>
                                </button>
                              )}
                              <button
                                className={`${styles.addBlock} ${styles.removeBlock}`}
                                disabled={
                                  busy ||
                                  needsSync ||
                                  (
                                    selectedSession?.orders[selectedBlock.path] ??
                                    selectedSession?.snapshot.orders[selectedBlock.path]?.map(
                                      (row) => row.id,
                                    ) ??
                                    []
                                  ).length <=
                                    (selectedSession?.snapshot.blockLimits?.[selectedBlock.path]
                                      ?.min ?? 0)
                                }
                                onClick={() =>
                                  removeBlock(
                                    selectedBlock.key,
                                    selectedBlock.path,
                                    selectedBlock.id,
                                  )
                                }
                                type="button"
                              >
                                <span className={styles.blockActionIcon}>
                                  <EditorIcon name="minus" />
                                </span>
                                <span>Remove block</span>
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <details
                    aria-label="Pending changes"
                    className={styles.changes}
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
                            <span>{humanize(path)}: blocks changed</span>
                            <button
                              disabled={busy || needsSync}
                              onClick={() => {
                                rememberEdit()
                                setSessions((previous) => {
                                  const orders = { ...previous[key].orders }
                                  const additions = { ...previous[key].additions }
                                  delete orders[path]
                                  delete additions[path]
                                  const prefixes = (previous[key].additions[path] ?? []).map(
                                    (_, index) =>
                                      `${path}.${previous[key].snapshot.orders[path].length + index}.`,
                                  )
                                  const changes = Object.fromEntries(
                                    Object.entries(previous[key].changes).filter(
                                      ([field]) =>
                                        !prefixes.some((prefix) => field.startsWith(prefix)),
                                    ),
                                  )
                                  const media = Object.fromEntries(
                                    Object.entries(previous[key].media).filter(
                                      ([field]) =>
                                        !prefixes.some((prefix) => field.startsWith(prefix)),
                                    ),
                                  )
                                  return {
                                    ...previous,
                                    [key]: { ...previous[key], orders, additions, changes, media },
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
                  {tab === 'publish' && (
                    <>
                      <PublishReview
                        items={reviewItems}
                        loading={reviewLoading}
                        failed={reviewFailed}
                        onEdit={(item) => {
                          const session = reviewSessions.current[item.key]
                          if (!session) return
                          setSessions((previous) => ({
                            ...previous,
                            [item.key]: previous[item.key] ?? session,
                          }))
                          selectOwner(item.key)
                          setTarget(undefined)
                          setSelectedBlock(undefined)
                          setSelectedRow(undefined)
                          setTab('content')
                          setBlockMode('edit')
                        }}
                      />
                      {!busy && (
                        <button
                          className={styles.reviewAction}
                          type="button"
                          onClick={() => void preparePublish()}
                        >
                          <span className={styles.refreshIcon} aria-hidden="true" />
                          Refresh review
                        </button>
                      )}
                    </>
                  )}
                  {tab === 'revisions' && (
                    <>
                      {Object.keys(sessions).length > 1 && (
                        <label>
                          History for
                          <select
                            aria-label="History for"
                            value={historyOwnerKey ?? documentKey(documentInfo)}
                            onChange={(event) => setHistoryOwnerKey(event.target.value)}
                          >
                            {Object.entries(sessions).map(([key, session]) => (
                              <option key={key} value={key}>
                                {session.snapshot.label || session.owner.collection}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <RevisionHistory
                        apiRoute={apiRoute}
                        key={historyOwnerKey ?? documentKey(documentInfo)}
                        owner={
                          sessions[historyOwnerKey ?? documentKey(documentInfo)]?.owner ??
                          documentInfo
                        }
                        refresh={revisionRefresh}
                        onPreview={previewRevision}
                        onReturn={returnFromRevision}
                        onRestore={restoreRevision}
                        canRestore={
                          !busy && !needsSync && count === 0 && Object.keys(recoveries).length === 0
                        }
                      />
                    </>
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
                {tab === 'publish' && (
                  <p className={styles.reviewScope}>
                    {documentInfo.locale?.toUpperCase() || 'Selected locale'} + shared fields
                  </p>
                )}
                <button
                  disabled={
                    busy ||
                    needsSync ||
                    !!historical ||
                    tab === 'publish' ||
                    (!count && !hasRecoveries)
                  }
                  onClick={() => void submit('save')}
                  type="button"
                >
                  {busy && operation === 'save' ? 'Saving…' : 'Save draft'}
                  {count > 0 && !actionsContainer && <span className={styles.count}>{count}</span>}
                </button>
                <button
                  className={styles.primary}
                  disabled={
                    busy ||
                    needsSync ||
                    !!historical ||
                    !ready ||
                    !Object.keys(sessions).length ||
                    (!count && !hasDrafts && tab !== 'publish') ||
                    Object.keys(recoveries).length > 0 ||
                    (tab === 'publish' &&
                      (reviewFailed || !reviewItems.some((item) => item.status !== 'published')))
                  }
                  onClick={() => void (tab === 'publish' ? submit('publish') : preparePublish())}
                  type="button"
                >
                  {busy && operation === 'publish'
                    ? 'Publishing…'
                    : tab === 'publish'
                      ? 'Publish now'
                      : 'Publish all'}
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
          onClose={() => {
            setPickerSelection(undefined)
            setPicker(undefined)
          }}
          onSelect={(media) => {
            stage(picker, media.id, media)
            setPickerSelection(undefined)
            setPicker(undefined)
          }}
          selected={pickerSelection}
          onSelectionChange={setPickerSelection}
          path={picker.path}
          draftOrders={pickerOrders}
        />
      )}
    </>
  )
}
