'use client'

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'

import type {
  Annotation,
  PayloadCMSDocument,
  PendingAnnotation,
  SubmitAnnotation,
  DeleteAnnotationTicket,
} from '../../types.js'
import type { AnnotationPopupCSSHandle } from '../annotation-popup-css/index.js'

import { captureScreenshot } from '../../annotations/screenshot.js'
import { annotationLabel } from '../../utils/annotation-label.js'
import annotationStyles from '../workspace/styles.module.scss'
import { usePreviewRefresh } from '../../hooks/use-preview-refresh.js'
import {
  closestCrossingShadow,
  getAccessibilityInfo,
  getDetailedComputedStyles,
  getElementClasses,
  getForensicComputedStyles,
  getFullElementPath,
  getNearbyElements,
  getNearbyText,
  identifyElement,
  parseComputedStylesString,
} from '../../utils/element-identification.js'
import { documentKey, fieldDocument } from '../../utils/field-target.js'
import { originalRequestAnimationFrame, originalSetTimeout } from '../../utils/freeze-animations.js'
import { generateOutput } from '../../utils/generate-output.js'
import { generatePatches } from '../../utils/payloodcms-patches.js'
import { getReactComponentName } from '../../utils/react-detection.js'
import {
  findNearestComponentSource,
  formatSourceLocation,
  getSourceLocation,
} from '../../utils/source-location.js'
import {
  clearSessionId,
  clearWireframeState,
  getStorageKey,
  loadAllAnnotations,
  loadAnnotations,
  loadSessionId,
  loadToolbarHidden,
  saveAnnotations,
  saveAnnotationsWithSyncMarker,
  saveSessionId,
  saveToolbarHidden,
} from '../../utils/storage.js'
import {
  createSession,
  deleteAnnotation as deleteAnnotationFromServer,
  getSession,
  syncAnnotation,
  updateAnnotation as updateAnnotationOnServer,
} from '../../utils/sync.js'
import { AnnotationPopupCSS } from '../annotation-popup-css/index.js'
import { AnnotationEditor } from '../workspace/annotation-editor.js'
import { ArrangeEditor } from '../arrange-editor/index.js'
import {
  IconCopyAnimated,
  IconEdit,
  IconEyeAnimated,
  IconGear,
  IconListSparkle,
  IconSendArrow,
  IconTrashAlt,
  IconXmarkLarge,
} from '../icons/index.js'
import { MediaPicker } from '../media-picker/index.js'
import { imageFieldAt, previewImages } from '../media-picker/preview.js'
import { RichTextDialog } from '../rich-text-editor/dialog.js'
import { AnnotationMarker, ExitingMarker, PendingMarker } from './annotation-marker/index.js'
import { SettingsPanel } from './settings-panel/index.js'
import styles from './styles.module.scss'

/**
 * Composes element identification with React component detection.
 * This is the boundary where we combine framework-agnostic element ID
 * with React-specific component name detection.
 */
function identifyElementWithReact(
  element: HTMLElement,
  reactMode: ReactComponentMode = 'filtered',
): {
  /** Raw element name without React path */
  elementName: string
  /** Combined name for display (React path + element) */
  name: string
  /** DOM path */
  path: string
  /** React component path (e.g., '<SideNav> <LinkComponent>') */
  reactComponents: null | string
} {
  const { name: elementName, path } = identifyElement(element)

  // If React detection is off, just return element info
  if (reactMode === 'off') {
    return { name: elementName, elementName, path, reactComponents: null }
  }

  const reactInfo = getReactComponentName(element, { mode: reactMode })

  return {
    name: reactInfo.path ? `${reactInfo.path} ${elementName}` : elementName,
    elementName,
    path,
    reactComponents: reactInfo.path,
  }
}

/**
 * Identifies an element and returns a human-readable name + PayloadCMS field path
 */
export function identifyPayloadField(element: HTMLElement) {
  const marker = element.closest('[data-payload-path]')
  if (!marker || !(marker instanceof HTMLElement)) {
    return
  }
  const path = marker.dataset.payloadPath
  const { name } = identifyElement(element)
  return {
    name: path
      ? `${marker.dataset.payloadType === 'upload' ? 'Replace image' : marker.dataset.payloadType === 'richText' ? 'Edit rich text' : 'Edit text'} · ${path}`
      : name,
    path: path ?? 'Path not found',
  }
}

// Module-level flag to prevent re-animating on SPA page navigation
let hasPlayedEntranceAnimation = false

// =============================================================================
// Types
// =============================================================================

type SendState = {
  action: 'publish' | 'save' | 'webhook' | null
  state: 'failed' | 'idle' | 'sending' | 'sent'
}

type HoverInfo = {
  element: string
  elementName: string
  elementPath: string
  payloadFieldPath?: null | string
  reactComponents?: null | string
  rect: DOMRect | null
}

export type OutputDetailLevel = 'compact' | 'detailed' | 'forensic' | 'standard'
// ReactComponentMode is now derived from outputDetail when reactEnabled is true
export type ReactComponentMode = 'all' | 'filtered' | 'off' | 'smart'
type MarkerClickBehavior = 'delete' | 'edit'

export type ToolbarSettings = {
  annotationColorId: string
  autoClearAfterCopy: boolean
  blockInteractions: boolean
  markerClickBehavior: MarkerClickBehavior
  outputDetail: OutputDetailLevel
  reactEnabled: boolean
  webhooksEnabled: boolean
  webhookUrl: string
}

const DEFAULT_SETTINGS: ToolbarSettings = {
  annotationColorId: 'blue',
  autoClearAfterCopy: false,
  blockInteractions: true,
  markerClickBehavior: 'edit',
  outputDetail: 'standard',
  reactEnabled: true,
  webhooksEnabled: true,
  webhookUrl: '',
}

// Simple URL validation - checks for valid http(s) URL format
const isValidUrl = (url: string): boolean => {
  if (!url || !url.trim()) {
    return false
  }
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Maps output detail level to React detection mode
const OUTPUT_TO_REACT_MODE: Record<OutputDetailLevel, ReactComponentMode> = {
  compact: 'off',
  detailed: 'smart',
  forensic: 'all',
  standard: 'filtered',
}

export const COLOR_OPTIONS = [
  { id: 'indigo', label: 'Indigo', p3: 'color(display-p3 0.38 0.33 0.96)', srgb: '#6155F5' },
  { id: 'blue', label: 'Blue', p3: 'color(display-p3 0.00 0.53 1.00)', srgb: '#0088FF' },
  { id: 'cyan', label: 'Cyan', p3: 'color(display-p3 0.00 0.76 0.82)', srgb: '#00C3D0' },
  { id: 'green', label: 'Green', p3: 'color(display-p3 0.20 0.78 0.35)', srgb: '#34C759' },
  { id: 'yellow', label: 'Yellow', p3: 'color(display-p3 1.00 0.80 0.00)', srgb: '#FFCC00' },
  { id: 'orange', label: 'Orange', p3: 'color(display-p3 1.00 0.55 0.16)', srgb: '#FF8D28' },
  { id: 'red', label: 'Red', p3: 'color(display-p3 1.00 0.22 0.24)', srgb: '#FF383C' },
]

const injectAgentationColorTokens = () => {
  if (typeof document === 'undefined') {
    return
  }
  if (document.getElementById('agentation-color-tokens')) {
    return
  }
  const style = document.createElement('style')
  style.id = 'agentation-color-tokens'
  style.textContent = [
    ...COLOR_OPTIONS.map(
      (c) => `
      [data-agentation-accent="${c.id}"] {
        --agentation-color-accent: ${c.srgb};
      }

      @supports (color: color(display-p3 0 0 0)) {
        [data-agentation-accent="${c.id}"] {
          --agentation-color-accent: ${c.p3};
        }
      }
    `,
    ),
    `:root {
      ${COLOR_OPTIONS.map((c) => `--agentation-color-${c.id}: ${c.srgb};`).join('\n')}
    }`,
    `@supports (color: color(display-p3 0 0 0)) {
      :root {
        ${COLOR_OPTIONS.map((c) => `--agentation-color-${c.id}: ${c.p3};`).join('\n')}
      }
    }`,
  ].join('')
  document.head.appendChild(style)
}

injectAgentationColorTokens()

// =============================================================================
// Utils
// =============================================================================

/**
 * Recursively pierces shadow DOMs to find the deepest element at a point.
 * document.elementFromPoint() stops at shadow hosts, so we need to
 * recursively check inside open shadow roots to find the actual target.
 */
function deepElementFromPoint(x: number, y: number): HTMLElement | null {
  let element = document.elementFromPoint(x, y) as HTMLElement | null
  if (!element) {
    return null
  }

  // Keep drilling down through shadow roots
  while (element?.shadowRoot) {
    const deeper = element.shadowRoot.elementFromPoint(x, y) as HTMLElement | null
    if (!deeper || deeper === element) {
      break
    }
    element = deeper
  }

  return element
}

function isElementFixed(element: HTMLElement): boolean {
  let current: HTMLElement | null = element
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current)
    const position = style.position
    if (position === 'fixed' || position === 'sticky') {
      return true
    }
    current = current.parentElement
  }
  return false
}

function isRenderableAnnotation(annotation: Annotation): boolean {
  return annotation.status !== 'resolved' && annotation.status !== 'dismissed'
}

function detectSourceFile(element: Element): string | undefined {
  const result = getSourceLocation(element as HTMLElement)
  const loc = result.found ? result : findNearestComponentSource(element as HTMLElement)
  if (loc.found && loc.source) {
    return formatSourceLocation(loc.source, 'path')
  }
  return undefined
}

function isSameAnnotationElement(
  left: Pick<Annotation, 'elementPath' | 'fullPath' | 'payloadCMS'>,
  right: Pick<Annotation, 'elementPath' | 'fullPath' | 'payloadCMS'>,
) {
  if (JSON.stringify(left.payloadCMS.document) !== JSON.stringify(right.payloadCMS.document)) {
    return false
  }
  if (left.fullPath && right.fullPath) {
    return left.fullPath === right.fullPath
  }

  return left.elementPath === right.elementPath && left.payloadCMS.path === right.payloadCMS.path
}

// =============================================================================
// Types for Props
// =============================================================================

export type DemoAnnotation = {
  comment: string
  selectedText?: string
  selector: string
}

export type VisualEditorToolbarProps = {
  adminRoute?: string
  apiRoute?: string
  /** Custom class name applied to the toolbar container. Use to adjust positioning or z-index. */
  className?: string
  /** Whether to copy to clipboard when the copy button is clicked. Defaults to true. */
  copyToClipboard?: boolean
  demoAnnotations?: DemoAnnotation[]
  demoDelay?: number
  /** PayloadCMS document metadata. */
  documentInfo: PayloadCMSDocument
  enableDemoMode?: boolean
  /** Server URL for sync (e.g., "http://localhost:4747"). If not provided, uses localStorage only. */
  endpoint?: string
  /** Submit feedback through a host-owned ticket integration. */
  submitAnnotation?: SubmitAnnotation
  deleteAnnotationTicket?: DeleteAnnotationTicket
  /** Callback fired when an annotation is added. */
  onAnnotationAdd?: (annotation: Annotation) => void
  /** Callback fired when an annotation is deleted. */
  onAnnotationDelete?: (annotation: Annotation) => void
  /** Callback fired when all annotations are cleared. Receives the annotations that were cleared. */
  onAnnotationsClear?: (annotations: Annotation[]) => void
  /** Callback fired when an annotation comment is edited. */
  onAnnotationUpdate?: (annotation: Annotation) => void
  /** Callback fired when the copy button is clicked. Receives the markdown output. */
  onCopy?: (markdown: string) => void
  /** Called when a new session is created (only when endpoint is provided without sessionId). */
  onSessionCreated?: (sessionId: string) => void
  /** Callback fired when "Send to Agent" is clicked. Receives the markdown output and annotations. */
  onSubmit?: (output: string, annotations: Annotation[]) => void
  /** Pre-existing session ID to join. If not provided with endpoint, creates a new session. */
  sessionId?: string

  /** Webhook URL to receive annotation events. */
  webhookUrl?: string
  workspace?: {
    contextActionsContainer?: HTMLElement
    actionsContainer: HTMLElement
    onModeChange: (mode: 'annotate' | 'browse' | 'edit') => void
    onPendingChange: (
      pending: boolean,
      busy: boolean,
      count: number,
      status: string,
      blocks: number,
    ) => void
    historyContainer: HTMLElement
    headerContainer: HTMLElement
    annotationContainer: HTMLElement
    panelContainer: HTMLElement
  }
}

// =============================================================================
// Component
// =============================================================================

export function VisualEditorToolbar({
  adminRoute = '/admin',
  apiRoute = '/api',
  className: userClassName,
  copyToClipboard = true,
  demoAnnotations,
  demoDelay = 1000,
  documentInfo,
  enableDemoMode = false,
  endpoint,
  submitAnnotation,
  deleteAnnotationTicket,
  onAnnotationAdd,
  onAnnotationDelete,
  onAnnotationsClear,
  onAnnotationUpdate,
  onCopy,
  onSessionCreated,
  onSubmit,
  sessionId: initialSessionId,
  webhookUrl,
  workspace,
}: VisualEditorToolbarProps) {
  const [richTextTarget, setRichTextTarget] = useState<{
    document: PayloadCMSDocument
    path: string
  } | null>(null)
  const [selectionNotice, setSelectionNotice] = useState('')
  const [isActive, setIsActive] = useState(Boolean(workspace))
  const [mode, setMode] = useState<'annotate' | 'arrange' | 'editCMS'>('arrange')
  const refreshPreview = usePreviewRefresh()
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [mediaTarget, setMediaTarget] = useState<{
    document: PayloadCMSDocument
    element: HTMLElement
    path: string
  } | null>(null)
  useEffect(() => previewImages(annotations, document, documentInfo), [annotations, documentInfo])
  useEffect(() => {
    if (!isActive || mode !== 'editCMS') {
      return
    }
    const images = Array.from(
      document.querySelectorAll<HTMLElement>('img[data-payload-type="upload"]'),
    )
    const originals = images.map((image) => ({
      image,
      label: image.getAttribute('aria-label'),
      role: image.getAttribute('role'),
      tabIndex: image.getAttribute('tabindex'),
    }))
    for (const image of images) {
      image.tabIndex = 0
      image.setAttribute('role', 'button')
      image.setAttribute('aria-label', 'Replace image')
    }
    const activate = (event: KeyboardEvent) => {
      if (
        (event.key === 'Enter' || event.key === ' ') &&
        images.includes(event.target as HTMLElement)
      ) {
        event.preventDefault()
        ;(event.target as HTMLElement).click()
      }
    }
    document.addEventListener('keydown', activate)
    return () => {
      document.removeEventListener('keydown', activate)
      originals.forEach(({ image, label, role, tabIndex }) => {
        for (const [name, value] of [
          ['tabindex', tabIndex],
          ['role', role],
          ['aria-label', label],
        ]) {
          if (value === null) image.removeAttribute(name!)
          else image.setAttribute(name!, value)
        }
      })
    }
  }, [isActive, mode])
  const [showMarkers, setShowMarkers] = useState(true)
  const [isToolbarHidden, setIsToolbarHidden] = useState(() => loadToolbarHidden())
  const [isToolbarHiding, setIsToolbarHiding] = useState(false)

  const { hasDrafts } = documentInfo

  // Stop native events from bubbling past document.body when they originate
  // inside the toolbar portal. Without this, clicks on the toolbar propagate to
  // document-level listeners, triggering "click outside" handlers that close
  // modals, dropdowns, and drawers. We attach to body (not a wrapper div) so
  // React's synthetic event delegation (which also listens on body/root) still
  // works — we only block propagation from body → document/window.
  const portalWrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const stop = (e: Event) => {
      const wrapper = portalWrapperRef.current
      if (wrapper && wrapper.contains(e.target as Node)) {
        e.stopPropagation()
      }
    }
    const events = ['mousedown', 'click', 'pointerdown'] as const
    events.forEach((evt) => document.body.addEventListener(evt, stop))
    return () => {
      events.forEach((evt) => document.body.removeEventListener(evt, stop))
    }
  }, [])

  // Unified marker visibility state - controls both toolbar and eye toggle
  const [markersVisible, setMarkersVisible] = useState(false)
  const [markersExiting, setMarkersExiting] = useState(false)
  const [hoverInfo, setHoverInfo] = useState<HoverInfo | null>(null)
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 })
  const [pendingAnnotation, setPendingAnnotation] = useState<null | PendingAnnotation>(null)
  const [copied, setCopied] = useState(false)
  const [sendState, setSendState] = useReducer(
    (state: SendState, action: Partial<SendState>) => ({ ...state, ...action }),
    {
      action: null,
      state: 'idle',
    },
  )

  const [isClearing, setIsClearing] = useState(false)
  const [hoveredMarkerId, setHoveredMarkerId] = useState<null | string>(null)
  const [hoveredTargetElement, setHoveredTargetElement] = useState<HTMLElement | null>(null)
  const [deletingMarkerId, setDeletingMarkerId] = useState<null | string>(null)
  const [renumberFrom, setRenumberFrom] = useState<null | number>(null)

  const [editingTargetElement, setEditingTargetElement] = useState<HTMLElement | null>(null)

  const [scrollY, setScrollY] = useState(0)
  const [isScrolling, setIsScrolling] = useState(false)

  const [mounted, setMounted] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showSettingsVisible, setShowSettingsVisible] = useState(false)
  const [settingsPage, setSettingsPage] = useState<'automations' | 'main'>('main')
  const [tooltipsHidden, setTooltipsHidden] = useState(false)

  // Toolbar mode state
  const isEditCmsMode = mode === 'editCMS'
  const isAnnotateMode = mode === 'annotate'
  const isArrangeMode = mode === 'arrange'

  // Draw mode state
  const [drawStrokes, setDrawStrokes] = useState<
    Array<{ color: string; fixed: boolean; id: string; points: Array<{ x: number; y: number }> }>
  >([])

  const [hoveredDrawingIdx, setHoveredDrawingIdx] = useState<null | number>(null)

  const [tooltipSessionActive, setTooltipSessionActive] = useState(false)
  const tooltipSessionTimerRef = useRef<null | ReturnType<typeof originalSetTimeout>>(null)

  // Cmd+shift+click multi-select state
  const [pendingMultiSelectElements, setPendingMultiSelectElements] = useState<
    Array<{
      element: HTMLElement
      name: string
      path: string
      reactComponents?: string
      rect: DOMRect
    }>
  >([])
  const modifiersHeldRef = useRef({ cmd: false, shift: false })

  // Hide tooltips after button click until mouse leaves
  const hideTooltipsUntilMouseLeave = () => {
    setTooltipsHidden(true)
  }

  const showTooltipsAgain = () => {
    setTooltipsHidden(false)
  }

  const handleControlsMouseEnter = () => {
    if (!tooltipSessionActive) {
      tooltipSessionTimerRef.current = originalSetTimeout(() => setTooltipSessionActive(true), 850)
    }
  }

  const handleControlsMouseLeave = () => {
    if (tooltipSessionTimerRef.current) {
      clearTimeout(tooltipSessionTimerRef.current)
      tooltipSessionTimerRef.current = null
    }
    setTooltipSessionActive(false)
    showTooltipsAgain()
  }

  useEffect(() => {
    return () => {
      if (tooltipSessionTimerRef.current) {
        clearTimeout(tooltipSessionTimerRef.current)
      }
    }
  }, [])

  const [settings, setSettings] = useState<ToolbarSettings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('feedback-toolbar-settings') ?? '')
      return {
        ...DEFAULT_SETTINGS,
        ...saved,
        annotationColorId: COLOR_OPTIONS.find((c) => c.id === saved.annotationColorId)
          ? saved.annotationColorId
          : DEFAULT_SETTINGS.annotationColorId,
      }
    } catch {
      return DEFAULT_SETTINGS
    }
  })
  const [isDarkMode, setIsDarkMode] = useState(true)
  const [showEntranceAnimation, setShowEntranceAnimation] = useState(false)

  const toggleTheme = () => {
    portalWrapperRef.current?.classList.add(styles.disableTransitions)
    setIsDarkMode((previous) => !previous)
    originalRequestAnimationFrame(() => {
      portalWrapperRef.current?.classList.remove(styles.disableTransitions)
    })
  }

  // Check if running in development mode - React detection only works in development mode
  const isDevMode = process.env.NODE_ENV === 'development'

  // Effective React mode - derived from outputDetail when enabled
  const effectiveReactMode: ReactComponentMode =
    isDevMode && settings.reactEnabled ? OUTPUT_TO_REACT_MODE[settings.outputDetail] : 'off'

  // Server sync state
  const [currentSessionId, setCurrentSessionId] = useState<null | string>(initialSessionId ?? null)
  const sessionInitializedRef = useRef(false)
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'connecting' | 'disconnected'
  >(endpoint ? 'connecting' : 'disconnected')

  // Draggable toolbar state
  const [toolbarPosition, setToolbarPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const [isDraggingToolbar, setIsDraggingToolbar] = useState(false)
  const [dragStartPos, setDragStartPos] = useState<{
    toolbarX: number
    toolbarY: number
    x: number
    y: number
  } | null>(null)
  const justFinishedToolbarDragRef = useRef(false)

  // For animations - track which markers have animated in and which are exiting
  const [animatedMarkers, setAnimatedMarkers] = useState<Set<string>>(() => new Set())
  const [exitingMarkers, setExitingMarkers] = useState<Set<string>>(() => new Set())
  const [pendingExiting, setPendingExiting] = useState(false)
  const [editExiting, setEditExiting] = useState(false)

  const recentlyAddedIdRef = useRef<null | string>(null)
  const prevConnectionStatusRef = useRef<null | typeof connectionStatus>(null)

  const popupRef = useRef<AnnotationPopupCSSHandle>(null)
  const editPopupRef = useRef<AnnotationPopupCSSHandle>(null)
  const scrollTimeoutRef = useRef<null | ReturnType<typeof originalSetTimeout>>(null)

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/'

  // Handle showSettings changes with exit animation
  useEffect(() => {
    if (showSettings) {
      setShowSettingsVisible(true)
    } else {
      // Reset tooltips when settings close (fixes tooltips not showing after closing settings)
      setTooltipsHidden(false)
      // Reset to main page when settings close
      setSettingsPage('main')
      const timer = originalSetTimeout(() => setShowSettingsVisible(false), 0)
      return () => clearTimeout(timer)
    }
  }, [showSettings])

  // Unified marker visibility - depends on toolbar active, showMarkers toggle, and not blank canvas
  // This single effect handles all marker show/hide animations
  const shouldShowMarkers = isActive && showMarkers
  useEffect(() => {
    if (shouldShowMarkers) {
      // Show markers - reset animations and make visible
      setMarkersExiting(false)
      setMarkersVisible(true)
      setAnimatedMarkers(new Set())
      // After enter animations complete, mark all as animated
      const timer = originalSetTimeout(() => {
        setAnimatedMarkers((prev) => {
          const newSet = new Set(prev)
          annotations.forEach((a) => newSet.add(a.id))
          return newSet
        })
      }, 350)
      return () => clearTimeout(timer)
    } else if (markersVisible) {
      // Hide markers - start exit animation, then unmount
      setMarkersExiting(true)
      const timer = originalSetTimeout(() => {
        setMarkersVisible(false)
        setMarkersExiting(false)
      }, 250)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShowMarkers])

  // Mount and load
  useEffect(() => {
    setMounted(true)
    setScrollY(window.scrollY)
    const stored = loadAnnotations<Annotation>(pathname)
    setAnnotations(stored.filter(isRenderableAnnotation))

    // Trigger entrance animation only on first load (not on SPA navigation)
    if (!hasPlayedEntranceAnimation) {
      setShowEntranceAnimation(true)
      hasPlayedEntranceAnimation = true
      // Remove animation class after it completes (toolbar: 500ms, badge: 400ms delay + 300ms)
      originalSetTimeout(() => setShowEntranceAnimation(false), 750)
    }

    // Load saved theme preference, default to dark mode
    try {
      const savedTheme = localStorage.getItem('feedback-toolbar-theme')
      if (savedTheme !== null) {
        setIsDarkMode(savedTheme === 'dark')
      }
      // If no saved preference, keep default (dark mode)
    } catch (e) {
      // Ignore localStorage errors
    }

    // Load saved toolbar position
    try {
      const savedPosition = localStorage.getItem('feedback-toolbar-position')
      if (savedPosition) {
        const pos = JSON.parse(savedPosition)
        if (typeof pos.x === 'number' && typeof pos.y === 'number') {
          setToolbarPosition(pos)
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, [pathname])

  // Save settings
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('feedback-toolbar-settings', JSON.stringify(settings))
    }
  }, [settings, mounted])

  // Save theme preference
  useEffect(() => {
    if (mounted) {
      localStorage.setItem('feedback-toolbar-theme', isDarkMode ? 'dark' : 'light')
    }
  }, [isDarkMode, mounted])

  // Save toolbar position when drag ends
  const prevDraggingRef = useRef(false)
  useEffect(() => {
    const wasDragging = prevDraggingRef.current
    prevDraggingRef.current = isDraggingToolbar

    // Save position when dragging ends (transition from true to false)
    if (wasDragging && !isDraggingToolbar && toolbarPosition && mounted) {
      localStorage.setItem('feedback-toolbar-position', JSON.stringify(toolbarPosition))
    }
  }, [isDraggingToolbar, toolbarPosition, mounted])

  // Initialize server session (when endpoint is provided)
  useEffect(() => {
    if (!endpoint || !mounted || sessionInitializedRef.current) {
      return
    }
    sessionInitializedRef.current = true
    setConnectionStatus('connecting')

    const initSession = async () => {
      try {
        // Check for stored session ID to rejoin on refresh
        const storedSessionId = loadSessionId(pathname)
        const sessionIdToJoin = initialSessionId || storedSessionId
        let sessionEstablished = false

        if (sessionIdToJoin) {
          // Join existing session - server annotations are authoritative
          try {
            const session = await getSession(endpoint, sessionIdToJoin)
            setCurrentSessionId(session.id)
            setConnectionStatus('connected')
            saveSessionId(pathname, session.id)
            sessionEstablished = true

            // Find local annotations that need to be synced:
            // 1. Annotations never synced to any session
            // 2. Annotations synced to a different session
            // 3. Annotations marked as synced to THIS session but missing from server
            //    (handles server-side deletion)
            const allLocalAnnotations = loadAnnotations<Annotation>(pathname)
            const serverIds = new Set(session.annotations.map((a) => a.id))
            const localToMerge = allLocalAnnotations.filter((a) => {
              // If it exists on server, don't re-upload
              if (serverIds.has(a.id)) {
                return false
              }
              // Otherwise, needs to be synced (whether never synced, synced elsewhere, or missing from server)
              return true
            })

            // Sync unsynced local annotations to this session
            if (localToMerge.length > 0) {
              const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
              const pageUrl = `${baseUrl}${pathname}`

              const results = await Promise.allSettled(
                localToMerge.map((annotation) =>
                  syncAnnotation(endpoint, session.id, {
                    ...annotation,
                    sessionId: session.id,
                    url: pageUrl,
                  }),
                ),
              )

              const syncedAnnotations = results.map((result, i) => {
                if (result.status === 'fulfilled') {
                  return result.value
                }
                console.warn('[Agentation] Failed to sync annotation:', result.reason)
                return localToMerge[i]
              })

              // Mark merged annotations as synced
              const allAnnotations = [...session.annotations, ...syncedAnnotations]
              setAnnotations(allAnnotations.filter(isRenderableAnnotation))
              saveAnnotationsWithSyncMarker(
                pathname,
                allAnnotations.filter(isRenderableAnnotation),
                session.id,
              )
            } else {
              setAnnotations(session.annotations.filter(isRenderableAnnotation))
              saveAnnotationsWithSyncMarker(
                pathname,
                session.annotations.filter(isRenderableAnnotation),
                session.id,
              )
            }
          } catch (joinError) {
            // Session doesn't exist or expired - will create new below
            console.warn('[Agentation] Could not join session, creating new:', joinError)
            // Clear the stored session ID since it's invalid
            clearSessionId(pathname)
            // sessionEstablished remains false, will create new session
          }
        }

        // Create new session if we don't have one yet (either no stored ID, or rejoin failed)
        if (!sessionEstablished) {
          // Create new session for current page
          const currentUrl = typeof window !== 'undefined' ? window.location.href : '/'
          const session = await createSession(endpoint, currentUrl)
          setCurrentSessionId(session.id)
          setConnectionStatus('connected')
          saveSessionId(pathname, session.id)
          onSessionCreated?.(session.id)

          // Only sync annotations that have never been synced (no _syncedTo marker)
          const allAnnotations = loadAllAnnotations<Annotation>()
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''

          // Sync annotations from all pages in parallel
          const syncPromises: Promise<void>[] = []
          for (const [pagePath, annotations] of allAnnotations) {
            // Filter to only unsynced annotations
            const unsyncedAnnotations = annotations.filter(
              (a) => !(a as { _syncedTo?: string } & Annotation)._syncedTo,
            )
            if (unsyncedAnnotations.length === 0) {
              continue
            }

            const pageUrl = `${baseUrl}${pagePath}`
            const isCurrentPage = pagePath === pathname

            syncPromises.push(
              (async () => {
                try {
                  // Use current session for current page, create new sessions for other pages
                  const targetSession = isCurrentPage
                    ? session
                    : await createSession(endpoint, pageUrl)

                  const results = await Promise.allSettled(
                    unsyncedAnnotations.map((annotation) =>
                      syncAnnotation(endpoint, targetSession.id, {
                        ...annotation,
                        sessionId: targetSession.id,
                        url: pageUrl,
                      }),
                    ),
                  )

                  // Mark synced annotations and update local state for current page
                  const syncedAnnotations = results.map((result, i) => {
                    if (result.status === 'fulfilled') {
                      return result.value
                    }
                    console.warn('[Agentation] Failed to sync annotation:', result.reason)
                    return unsyncedAnnotations[i]
                  })

                  const renderableSyncedAnnotations =
                    syncedAnnotations.filter(isRenderableAnnotation)

                  // Save with sync marker
                  saveAnnotationsWithSyncMarker(
                    pagePath,
                    renderableSyncedAnnotations,
                    targetSession.id,
                  )

                  if (isCurrentPage) {
                    const originalIds = new Set(unsyncedAnnotations.map((a) => a.id))
                    setAnnotations((prev) => {
                      const newDuringSync = prev.filter((a) => !originalIds.has(a.id))
                      return [...renderableSyncedAnnotations, ...newDuringSync]
                    })
                  }
                } catch (err) {
                  console.warn(`[Agentation] Failed to sync annotations for ${pagePath}:`, err)
                }
              })(),
            )
          }

          await Promise.allSettled(syncPromises)
        }
      } catch (error) {
        // Network error - continue in local-only mode
        setConnectionStatus('disconnected')
        console.warn('[Agentation] Failed to initialize session, using local storage:', error)
      }
    }

    void initSession()
  }, [endpoint, initialSessionId, mounted, onSessionCreated, pathname])

  // Sync local annotations when connection is restored
  useEffect(() => {
    if (!endpoint || !mounted) {
      return
    }

    // Check if we just reconnected (was disconnected, now connected)
    const wasDisconnected = prevConnectionStatusRef.current === 'disconnected'
    const isNowConnected = connectionStatus === 'connected'
    prevConnectionStatusRef.current = connectionStatus

    if (wasDisconnected && isNowConnected) {
      // Sync any local annotations that aren't on the server
      const syncLocalAnnotations = async () => {
        try {
          const localAnnotations = loadAnnotations<Annotation>(pathname)
          if (localAnnotations.length === 0) {
            return
          }

          const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
          const pageUrl = `${baseUrl}${pathname}`

          // Get or create session
          let sessionId = currentSessionId
          let serverAnnotations: Annotation[] = []

          if (sessionId) {
            // Try to get existing session
            try {
              const session = await getSession(endpoint, sessionId)
              serverAnnotations = session.annotations
            } catch {
              // Session doesn't exist anymore, create new one
              sessionId = null
            }
          }

          if (!sessionId) {
            // Create new session
            const newSession = await createSession(endpoint, pageUrl)
            sessionId = newSession.id
            setCurrentSessionId(sessionId)
            saveSessionId(pathname, sessionId)
          }

          // Find annotations that need syncing
          const serverIds = new Set(serverAnnotations.map((a) => a.id))
          const unsyncedLocal = localAnnotations.filter((a) => !serverIds.has(a.id))

          if (unsyncedLocal.length > 0) {
            const results = await Promise.allSettled(
              unsyncedLocal.map((annotation) =>
                syncAnnotation(endpoint, sessionId, {
                  ...annotation,
                  sessionId,
                  url: pageUrl,
                }),
              ),
            )

            const syncedAnnotations = results.map((result, i) => {
              if (result.status === 'fulfilled') {
                return result.value
              }
              console.warn('[Agentation] Failed to sync annotation on reconnect:', result.reason)
              return unsyncedLocal[i]
            })

            // Update local state with server + synced annotations
            const allAnnotations = [...serverAnnotations, ...syncedAnnotations]
            const renderableAnnotations = allAnnotations.filter(isRenderableAnnotation)
            setAnnotations(renderableAnnotations)
            saveAnnotationsWithSyncMarker(pathname, renderableAnnotations, sessionId)
          }
        } catch (err) {
          console.warn('[Agentation] Failed to sync on reconnect:', err)
        }
      }

      void syncLocalAnnotations()
    }
  }, [connectionStatus, endpoint, mounted, currentSessionId, pathname])

  const hideToolbarTemporarily = useCallback(() => {
    if (isToolbarHiding) {
      return
    }
    setIsToolbarHiding(true)
    setShowSettings(false)
    setIsActive(false)
    originalSetTimeout(() => {
      saveToolbarHidden(true)
      setIsToolbarHidden(true)
      setIsToolbarHiding(false)
    }, 400)
  }, [isToolbarHiding])

  // Track scroll
  useEffect(() => {
    const handleScroll = () => {
      setScrollY(window.scrollY)
      setIsScrolling(true)

      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }

      scrollTimeoutRef.current = originalSetTimeout(() => {
        setIsScrolling(false)
      }, 150)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Save annotations (preserving sync markers if connected to a session)
  useEffect(() => {
    if (mounted && annotations.length > 0) {
      if (currentSessionId) {
        // Connected to session - save with sync marker to prevent re-upload on refresh
        saveAnnotationsWithSyncMarker(pathname, annotations, currentSessionId)
      } else {
        // Not connected - save without markers (will sync when connected)
        saveAnnotations(pathname, annotations)
      }
    } else if (mounted && annotations.length === 0) {
      localStorage.removeItem(getStorageKey(pathname))
    }
  }, [annotations, pathname, mounted, currentSessionId])

  // Visually move/resize original DOM elements to match rearrange state.
  // Lives here (not in RearrangeOverlay) so transforms persist across sub-mode
  // switches (rearrange ↔ add) and animate back when layout mode exits.
  type MovedEntry = {
    ancestors: { el: HTMLElement; overflow: string }[]
    el: HTMLElement
    origStyles: {
      display: string
      opacity: string
      position: string
      transform: string
      transformOrigin: string
      zIndex: string
    }
  }
  const rearrangeMovedEls = useRef<Map<string, MovedEntry>>(new Map())
  useLayoutEffect(() => {
    const active = new Set<string>()

    // Restore elements that are no longer captured or layout mode exited
    for (const [id, entry] of rearrangeMovedEls.current) {
      if (!active.has(id)) {
        const { ancestors, el, origStyles } = entry
        el.style.transition =
          'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1)'
        el.style.transform = origStyles.transform
        el.style.transformOrigin = origStyles.transformOrigin
        el.style.opacity = origStyles.opacity
        el.style.position = origStyles.position
        el.style.zIndex = origStyles.zIndex
        rearrangeMovedEls.current.delete(id)
        originalSetTimeout(() => {
          el.style.transition = ''
          el.style.display = origStyles.display
          for (const a of ancestors) {
            a.el.style.overflow = a.overflow
          }
        }, 450)
      }
    }
  }, [isActive])

  // Clean up all moved elements on unmount — animate back to original positions
  useEffect(() => {
    const rearrangeMovedElsCopy = rearrangeMovedEls.current
    return () => {
      for (const [, entry] of rearrangeMovedElsCopy) {
        const { ancestors, el, origStyles } = entry
        el.style.transition =
          'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.4s cubic-bezier(0.22, 1, 0.36, 1)'
        el.style.transform = origStyles.transform
        el.style.transformOrigin = origStyles.transformOrigin
        el.style.opacity = origStyles.opacity
        el.style.position = origStyles.position
        el.style.zIndex = origStyles.zIndex
        // Clean up transition + display + ancestors after animation completes
        originalSetTimeout(() => {
          el.style.transition = ''
          el.style.display = origStyles.display
          for (const a of ancestors) {
            a.el.style.overflow = a.overflow
          }
        }, 450)
      }
      rearrangeMovedEls.current.clear()
    }
  }, [])

  // Deactivate toolbar
  const deactivate = useCallback(() => {
    setIsActive(false)
  }, [])

  // Create pending annotation from cmd+shift+click multi-select
  //removed

  // Reset state when deactivating
  useEffect(() => {
    if (!isActive) {
      setPendingAnnotation(null)
      setPendingAnnotation(null)
      setEditingTargetElement(null)
      setHoverInfo(null)
      setShowSettings(false) // Close settings when toolbar closes
      // Clear multi-select removed
      modifiersHeldRef.current = { cmd: false, shift: false } // Reset modifier tracking
    }
  }, [isActive])

  // Custom cursor
  useEffect(() => {
    if (!isActive) {
      return
    }

    const textElementsSelector = [
      'p',
      'span',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'li',
      'td',
      'th',
      'label',
      'blockquote',
      'figcaption',
      'caption',
      'legend',
      'dt',
      'dd',
      'pre',
      'code',
      'em',
      'strong',
      'b',
      'i',
      'u',
      's',
      'a',
      'time',
      'address',
      'cite',
      'q',
      'abbr',
      'dfn',
      'mark',
      'small',
      'sub',
      'sup',
      '[contenteditable]',
    ].join(', ')

    const notAgentationSelector = `:not([data-agentation-root]):not([data-agentation-root] *)`

    const style = document.createElement('style')
    style.id = 'feedback-cursor-styles'
    // Text elements get text cursor (higher specificity with body prefix)
    // Everything else gets crosshair
    style.textContent = `
      body ${notAgentationSelector} {
        cursor: crosshair !important;
      }

      body :is(${textElementsSelector})${notAgentationSelector} {
        cursor: text !important;
      }
    `
    document.head.appendChild(style)

    return () => {
      const existingStyle = document.getElementById('feedback-cursor-styles')
      if (existingStyle) {
        existingStyle.remove()
      }
    }
  }, [isActive])

  // Cursor change when hovering a drawing stroke (both draw mode and normal mode)
  useEffect(() => {
    if (hoveredDrawingIdx !== null && isActive) {
      document.documentElement.setAttribute('data-drawing-hover', '')
      return () => document.documentElement.removeAttribute('data-drawing-hover')
    }
  }, [hoveredDrawingIdx, isActive])

  // Handle mouse move
  useEffect(() => {
    if (!isActive || isArrangeMode || pendingAnnotation?.state === 'pending') {
      return
    }

    const handleMouseMove = (e: MouseEvent) => {
      // Use composedPath to get actual target inside shadow DOM
      const target = (e.composedPath()[0] || e.target) as HTMLElement
      if (closestCrossingShadow(target, '[data-feedback-toolbar]')) {
        setHoverInfo(null)
        return
      }

      const elementUnder = deepElementFromPoint(e.clientX, e.clientY)
      if (!elementUnder || closestCrossingShadow(elementUnder, '[data-feedback-toolbar]')) {
        setHoverInfo(null)
        return
      }

      const payloadField = identifyPayloadField(elementUnder)
      const { name, elementName, path, reactComponents } = identifyElementWithReact(
        elementUnder,
        effectiveReactMode,
      )
      const rect = elementUnder.getBoundingClientRect()

      setHoverInfo({
        element: name,
        elementName: payloadField?.name ?? elementName,
        elementPath: path,
        reactComponents,
        rect,
      })
      setHoverPosition({ x: e.clientX, y: e.clientY })
    }

    document.addEventListener('mousemove', handleMouseMove)
    return () => document.removeEventListener('mousemove', handleMouseMove)
  }, [isActive, isArrangeMode, pendingAnnotation, effectiveReactMode, drawStrokes])

  // Start editing an annotation (right-click or click on drawing stroke)
  const startEditAnnotation = useCallback(
    (annotation: Annotation) => {
      if (annotation.ticketRequest) {
        setSelectionNotice('Submitted notes stay unchanged. Add another note for further feedback.')
        return
      }
      if (annotation.media) {
        const element = Array.from(
          document.querySelectorAll<HTMLElement>('[data-payload-path]'),
        ).find(
          (el) =>
            el.dataset.payloadPath === annotation.payloadCMS.path &&
            documentKey(fieldDocument(el, documentInfo)) ===
              documentKey(annotation.payloadCMS.document ?? documentInfo),
        )
        if (element) {
          setMediaTarget({
            document: annotation.payloadCMS.document ?? documentInfo,
            element,
            path: annotation.payloadCMS.path,
          })
        }
        return
      }
      setPendingAnnotation({ ...annotation, state: 'edit' })
      setHoveredMarkerId(null)
      setHoveredTargetElement(null)

      // Try to find elements at the annotation's position(s) for live tracking (removed multi support)
      if (annotation.boundingBox) {
        // Single element
        const bb = annotation.boundingBox
        const centerX = bb.x + bb.width / 2
        // Convert document coords to viewport coords (unless fixed)
        const centerY = annotation.isFixed
          ? bb.y + bb.height / 2
          : bb.y + bb.height / 2 - window.scrollY
        const el = deepElementFromPoint(centerX, centerY)

        // Validate found element's size roughly matches stored bounding box
        if (el) {
          const elRect = el.getBoundingClientRect()
          const widthRatio = elRect.width / bb.width
          const heightRatio = elRect.height / bb.height
          if (widthRatio < 0.5 || heightRatio < 0.5) {
            setEditingTargetElement(null)
          } else {
            setEditingTargetElement(el)
          }
        } else {
          setEditingTargetElement(null)
        }
      } else {
        setEditingTargetElement(null)
      }
    },
    [documentInfo],
  )

  // Handle click
  useEffect(() => {
    if (!isActive || isArrangeMode) {
      return
    }

    const handleClick = (e: MouseEvent) => {
      // Use composedPath to get actual target inside shadow DOM, falling back to e.target
      const target = (e.composedPath()[0] || e.target) as HTMLElement

      if (closestCrossingShadow(target, '[data-feedback-toolbar]')) {
        return
      }
      if (closestCrossingShadow(target, '[data-annotation-popup]')) {
        return
      }
      if (closestCrossingShadow(target, '[data-annotation-marker]')) {
        return
      }

      if (richTextTarget) {
        return
      }
      if (mediaTarget) {
        return
      }
      const owner = fieldDocument(target, documentInfo)
      if (isEditCmsMode && !owner) {
        e.preventDefault()
        e.stopPropagation()
        setSelectionNotice('This field has invalid document information and cannot be edited.')
        return
      }
      const imageField = imageFieldAt(target)
      if (isEditCmsMode && imageField) {
        e.preventDefault()
        e.stopPropagation()
        setSelectionNotice('')
        setMediaTarget({ ...imageField, document: owner ?? documentInfo })
        return
      }
      const payloadField = identifyPayloadField(target)
      if (isEditCmsMode && payloadField?.path && target.closest('[data-payload-type="richText"]')) {
        e.preventDefault()
        e.stopPropagation()
        setSelectionNotice('')
        setRichTextTarget({
          document: owner ?? documentInfo,
          path: payloadField.path,
        })
        setHoverInfo(null)
        return
      }

      if (isEditCmsMode && !payloadField?.path) {
        if (target.closest('img, picture, h1, h2, h3, h4, p, a, span, blockquote')) {
          e.preventDefault()
          e.stopPropagation()
          setSelectionNotice(
            'This content has no editable CMS field on this page. It may come from shared content, commerce, or the site design.',
          )
        }
        return
      }

      setSelectionNotice('')
      const isInteractive = closestCrossingShadow(
        target,
        "button, a, input, select, textarea, [role='button'], [onclick]",
      )

      // Block interactions on interactive elements when enabled
      if (settings.blockInteractions && isInteractive) {
        e.preventDefault()
        e.stopPropagation()
        // Still create annotation on the interactive element
      }

      const elementUnder = deepElementFromPoint(e.clientX, e.clientY)
      if (!elementUnder) {
        return
      }

      const {
        name,
        path: reactPath,
        reactComponents,
      } = identifyElementWithReact(elementUnder, effectiveReactMode)

      const rect = elementUnder.getBoundingClientRect()
      const x = (e.clientX / window.innerWidth) * 100

      const isFixed = isElementFixed(elementUnder)
      const y = isFixed ? e.clientY : e.clientY + window.scrollY

      const selection = window.getSelection()
      let selectedText: string | undefined
      if (selection && selection.toString().trim().length > 0) {
        selectedText = selection.toString().trim().slice(0, 500)
      }

      const path = payloadField?.path ?? reactPath
      const fullPath = getFullElementPath(elementUnder)
      const existingAnnotation = isEditCmsMode
        ? annotations.find((annotation) =>
            isSameAnnotationElement(annotation, {
              elementPath: path,
              fullPath,
              payloadCMS: { path, value: '' },
            }),
          )
        : undefined

      if (pendingAnnotation?.state === 'pending') {
        if (isInteractive && !settings.blockInteractions) {
          return
        }
        e.preventDefault()
        popupRef.current?.shake()
        return
      }

      if (pendingAnnotation?.state === 'edit') {
        if (isInteractive && !settings.blockInteractions) {
          return
        }
        e.preventDefault()
        editPopupRef.current?.shake()
        return
      }

      if (existingAnnotation) {
        e.preventDefault()
        setHoverInfo(null)
        startEditAnnotation(existingAnnotation)
        return
      }

      e.preventDefault()

      // Capture computed styles - filtered for popup, full for forensic output
      const computedStylesObj = getDetailedComputedStyles(elementUnder)
      const computedStylesStr = getForensicComputedStyles(elementUnder)
      // annotation creation starts here
      setPendingAnnotation({
        id: crypto.randomUUID(),
        accessibility: getAccessibilityInfo(elementUnder),
        boundingBox: {
          height: rect.height,
          width: rect.width,
          x: rect.left,
          y: isFixed ? rect.top : rect.top + window.scrollY,
        },
        clientY: e.clientY,
        comment: '',
        computedStyles: computedStylesStr,
        computedStylesObj,
        cssClasses: getElementClasses(elementUnder),
        element: name,
        elementPath: path,
        fullPath,
        isFixed,
        nearbyElements: getNearbyElements(elementUnder),
        nearbyText: getNearbyText(elementUnder),
        payloadCMS: {
          document: isEditCmsMode ? (owner ?? undefined) : undefined,
          path: isEditCmsMode ? path : '',
          value: '',
        },
        reactComponents: reactComponents ?? undefined,
        selectedText,
        sourceFile: detectSourceFile(elementUnder),
        state: 'pending',
        targetElement: elementUnder, // Store for live position queries
        timestamp: Date.now(),
        x,
        y,
      })
      setHoverInfo(null)
    }

    // Use capture phase to intercept before element handlers
    document.addEventListener('click', handleClick, true)
    return () => document.removeEventListener('click', handleClick, true)
  }, [
    isActive,
    annotations,
    isEditCmsMode,
    isArrangeMode,
    pendingAnnotation,
    startEditAnnotation,
    mediaTarget,
    richTextTarget,
    documentInfo,
    settings.blockInteractions,
    effectiveReactMode,
    pendingMultiSelectElements,
  ])

  // Fire webhook for annotation events - returns true on success, false on failure
  const fireWebhook = useCallback(
    async (event: string, payload: Record<string, unknown>, force?: boolean): Promise<boolean> => {
      // Settings webhookUrl overrides prop
      const targetUrl = settings.webhookUrl || webhookUrl
      // Skip if no URL, or if webhooks disabled (unless force is true for manual sends)
      if (!targetUrl || (!settings.webhooksEnabled && !force)) {
        return false
      }

      try {
        const response = await fetch(targetUrl, {
          body: JSON.stringify({
            event,
            timestamp: Date.now(),
            url: typeof window !== 'undefined' ? window.location.href : undefined,
            ...payload,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        })
        return response.ok
      } catch (error) {
        console.warn('[Agentation] Webhook failed:', error)
        return false
      }
    },
    [webhookUrl, settings.webhookUrl, settings.webhooksEnabled],
  )

  const ticketSubmissions = useRef(new Set<string>())
  const [sendingTickets, setSendingTickets] = useState<Set<string>>(new Set())
  const sendAnnotationTicket = useCallback(
    async (annotation: Annotation) => {
      if (
        !submitAnnotation ||
        !annotation.ticketRequest ||
        (annotation.ticket && !annotation.ticket.screenshotError) ||
        ticketSubmissions.current.has(annotation.id)
      )
        return
      ticketSubmissions.current.add(annotation.id)
      setSendingTickets(new Set(ticketSubmissions.current))
      try {
        let request = annotation.ticketRequest
        if (!request.screenshot) {
          await captureScreenshot(annotation.id)
          request = { ...request, screenshot: true }
          // Persist the immutable capture flag before any external write.
          const stored = loadAnnotations<Annotation>(pathname)
          const updated = { ...annotation, ticketRequest: request }
          const notes = stored.some((item) => item.id === annotation.id)
            ? stored.map((item) => (item.id === annotation.id ? updated : item))
            : [...stored, updated]
          localStorage.setItem(getStorageKey(pathname), JSON.stringify(notes))
          setAnnotations((items) =>
            items.map((item) => (item.id === annotation.id ? updated : item)),
          )
        }
        const ticket = await submitAnnotation(request, annotation.ticket)
        setAnnotations((items) =>
          items.map((item) =>
            item.id === annotation.id
              ? { ...item, ticket, ticketError: ticket.screenshotError }
              : item,
          ),
        )
      } catch (error) {
        setAnnotations((items) =>
          items.map((item) =>
            item.id === annotation.id
              ? {
                  ...item,
                  ticketError:
                    error instanceof Error ? error.message : 'Unable to send feedback. Try again.',
                }
              : item,
          ),
        )
      } finally {
        ticketSubmissions.current.delete(annotation.id)
        setSendingTickets(new Set(ticketSubmissions.current))
      }
    },
    [submitAnnotation, pathname],
  )

  // Add annotation
  const addAnnotation = useCallback(
    (comment: string) => {
      if (pendingAnnotation?.state !== 'pending') {
        return
      }

      const existingAnnotation = isEditCmsMode
        ? annotations.find((annotation) => isSameAnnotationElement(annotation, pendingAnnotation))
        : undefined

      const newAnnotation: Annotation = {
        id: crypto.randomUUID(),
        accessibility: pendingAnnotation.accessibility,
        boundingBox: pendingAnnotation.boundingBox,
        comment,
        computedStyles: pendingAnnotation.computedStyles,
        cssClasses: pendingAnnotation.cssClasses,
        element: pendingAnnotation.element,
        elementBoundingBoxes: pendingAnnotation.elementBoundingBoxes,
        elementPath: pendingAnnotation.elementPath,
        fullPath: pendingAnnotation.fullPath,
        isFixed: pendingAnnotation.isFixed,
        isMultiSelect: pendingAnnotation.isMultiSelect,
        nearbyElements: pendingAnnotation.nearbyElements,
        nearbyText: pendingAnnotation.nearbyText,
        payloadCMS: { ...pendingAnnotation.payloadCMS, value: comment },
        reactComponents: pendingAnnotation.reactComponents,
        selectedText: pendingAnnotation.selectedText,
        sourceFile: pendingAnnotation.sourceFile,
        timestamp: Date.now(),
        x: pendingAnnotation.x,
        y: pendingAnnotation.y,
        // Protocol fields for server sync
        ...(endpoint && currentSessionId
          ? {
              sessionId: currentSessionId,
              status: 'pending' as const,
              url: typeof window !== 'undefined' ? window.location.href : undefined,
            }
          : {}),
      }

      if (existingAnnotation) {
        const updatedAnnotation: Annotation = {
          ...existingAnnotation,
          ...newAnnotation,
          id: existingAnnotation.id,
        }

        setAnnotations((prev) =>
          prev.map((annotation) =>
            annotation.id === existingAnnotation.id ? updatedAnnotation : annotation,
          ),
        )

        onAnnotationUpdate?.(updatedAnnotation)
        void fireWebhook('annotation.update', { annotation: updatedAnnotation })

        if (endpoint) {
          updateAnnotationOnServer(endpoint, existingAnnotation.id, {
            comment,
          }).catch((error) => {
            console.warn('[Agentation] Failed to update annotation on server:', error)
          })
        }

        setPendingExiting(true)
        originalSetTimeout(() => {
          setPendingAnnotation(null)
          setPendingExiting(false)
        }, 150)

        window.getSelection()?.removeAllRanges()
        return
      }

      if (submitAnnotation && !isEditCmsMode && documentInfo) {
        newAnnotation.ticketRequest = {
          createdAt: newAnnotation.timestamp,
          id: newAnnotation.id,
          comment,
          element: newAnnotation.element,
          elementPath: newAnnotation.elementPath,
          url: `${window.location.origin}${window.location.pathname}`,
          document: documentInfo,
          x: newAnnotation.x,
          y: newAnnotation.y,
        }
      }
      setAnnotations((prev) => [...prev, newAnnotation])
      void sendAnnotationTicket(newAnnotation)
      // Prevent immediate hover on newly added marker
      recentlyAddedIdRef.current = newAnnotation.id
      originalSetTimeout(() => {
        recentlyAddedIdRef.current = null
      }, 300)
      // Mark as needing animation (will be set to animated after animation completes)
      originalSetTimeout(() => {
        setAnimatedMarkers((prev) => new Set(prev).add(newAnnotation.id))
      }, 250)

      // Fire callback
      onAnnotationAdd?.(newAnnotation)
      void fireWebhook('annotation.add', { annotation: newAnnotation })

      // Animate out the pending annotation UI
      setPendingExiting(true)
      originalSetTimeout(() => {
        setPendingAnnotation(null)
        setPendingExiting(false)
      }, 150)

      window.getSelection()?.removeAllRanges()

      // Sync to server (non-blocking, but update local ID with server's ID)
      if (endpoint && currentSessionId) {
        syncAnnotation(endpoint, currentSessionId, newAnnotation)
          .then((serverAnnotation) => {
            // Update local annotation with server-assigned ID
            if (serverAnnotation.id !== newAnnotation.id) {
              setAnnotations((prev) =>
                prev.map((a) =>
                  a.id === newAnnotation.id ? { ...a, id: serverAnnotation.id } : a,
                ),
              )
              // Also update the animated markers set
              setAnimatedMarkers((prev) => {
                const next = new Set(prev)
                next.delete(newAnnotation.id)
                next.add(serverAnnotation.id)
                return next
              })
            }
          })
          .catch((error) => {
            console.warn('[Agentation] Failed to sync annotation:', error)
          })
      }
    },
    [
      pendingAnnotation,
      submitAnnotation,
      sendAnnotationTicket,
      documentInfo,
      isEditCmsMode,
      annotations,
      onAnnotationAdd,
      onAnnotationUpdate,
      fireWebhook,
      endpoint,
      currentSessionId,
    ],
  )

  // Cancel annotation with exit animation
  const cancelAnnotation = useCallback(() => {
    setPendingExiting(true)
    originalSetTimeout(() => {
      setPendingAnnotation(null)
      setPendingExiting(false)
    }, 150) // Match exit animation duration
  }, [])

  // Delete annotation with exit animation
  const deleteAnnotation = useCallback(
    (id: string) => {
      const deletedIndex = annotations.findIndex((a) => a.id === id)
      const deletedAnnotation = annotations[deletedIndex]

      // Close edit panel with exit animation if deleting the annotation being edited
      if (pendingAnnotation?.id === id && pendingAnnotation.state === 'edit') {
        setEditExiting(true)
        originalSetTimeout(() => {
          setPendingAnnotation(null)
          setEditingTargetElement(null)

          setEditExiting(false)
        }, 150)
      }

      setDeletingMarkerId(id)
      setExitingMarkers((prev) => new Set(prev).add(id))

      // Fire callback
      if (deletedAnnotation) {
        onAnnotationDelete?.(deletedAnnotation)
        void fireWebhook('annotation.delete', { annotation: deletedAnnotation })
      }

      // Sync delete to server (non-blocking)
      if (endpoint) {
        deleteAnnotationFromServer(endpoint, id).catch((error) => {
          console.warn('[Agentation] Failed to delete annotation from server:', error)
        })
      }

      // Wait for exit animation then remove
      originalSetTimeout(() => {
        setAnnotations((prev) => prev.filter((a) => a.id !== id))
        setExitingMarkers((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setDeletingMarkerId(null)

        // Trigger renumber animation for markers after deleted one
        if (deletedIndex < annotations.length - 1) {
          setRenumberFrom(deletedIndex)
          originalSetTimeout(() => setRenumberFrom(null), 200)
        }
      }, 150)
    },
    [annotations, pendingAnnotation, onAnnotationDelete, fireWebhook, endpoint],
  )

  const [annotationTab, setAnnotationTab] = useState<'active' | 'archived'>('active')
  const [deletingTickets, setDeletingTickets] = useState<Set<string>>(new Set())
  const deletingTicketIds = useRef(new Set<string>())
  const [ticketDeleteErrors, setTicketDeleteErrors] = useState<Record<string, string>>({})
  const archiveAnnotation = (id: string, archived: boolean) => {
    setAnnotations((items) =>
      items.map((item) =>
        item.id === id
          ? { ...item, archivedAt: archived ? new Date().toISOString() : undefined }
          : item,
      ),
    )
  }
  const removeTicket = async (annotation: Annotation) => {
    if (
      !deleteAnnotationTicket ||
      !annotation.ticket ||
      !annotation.ticketRequest ||
      deletingTicketIds.current.has(annotation.id)
    )
      return
    deletingTicketIds.current.add(annotation.id)
    setDeletingTickets(new Set(deletingTicketIds.current))
    setTicketDeleteErrors((errors) => ({ ...errors, [annotation.id]: '' }))
    try {
      await deleteAnnotationTicket(annotation.ticketRequest, annotation.ticket)
      deleteAnnotation(annotation.id)
    } catch (error) {
      setTicketDeleteErrors((errors) => ({
        ...errors,
        [annotation.id]:
          error instanceof Error ? error.message : 'Unable to delete ticket. Try again.',
      }))
    } finally {
      deletingTicketIds.current.delete(annotation.id)
      setDeletingTickets(new Set(deletingTicketIds.current))
    }
  }

  // Handle marker hover - finds element(s) for live position tracking
  const handleMarkerHover = useCallback((annotation: Annotation | null) => {
    if (!annotation) {
      setHoveredMarkerId(null)
      setHoveredTargetElement(null)

      return
    }

    setHoveredMarkerId(annotation.id)

    // Find elements at the annotation's position(s) for live tracking
    if (annotation.elementBoundingBoxes?.length) {
      // Cmd+shift+click: find element at each bounding box center
      const elements: HTMLElement[] = []
      for (const bb of annotation.elementBoundingBoxes) {
        const centerX = bb.x + bb.width / 2
        const centerY = bb.y + bb.height / 2 - window.scrollY
        // Use elementsFromPoint to look through the marker if it's covering
        const allEls = document.elementsFromPoint(centerX, centerY)
        const el = allEls.find(
          (e) => !e.closest('[data-annotation-marker]') && !e.closest('[data-agentation-root]'),
        ) as HTMLElement | undefined
        if (el) {
          elements.push(el)
        }
      }

      setHoveredTargetElement(null)
    } else if (annotation.boundingBox) {
      // Single element
      const bb = annotation.boundingBox
      const centerX = bb.x + bb.width / 2
      const centerY = annotation.isFixed
        ? bb.y + bb.height / 2
        : bb.y + bb.height / 2 - window.scrollY
      const el = deepElementFromPoint(centerX, centerY)

      // Validate found element's size roughly matches stored bounding box
      // (prevents using wrong child element when clicking center of a container)
      if (el) {
        const elRect = el.getBoundingClientRect()
        const widthRatio = elRect.width / bb.width
        const heightRatio = elRect.height / bb.height
        // If found element is much smaller than stored, it's probably a child - don't use it
        if (widthRatio < 0.5 || heightRatio < 0.5) {
          setHoveredTargetElement(null)
        } else {
          setHoveredTargetElement(el)
        }
      } else {
        setHoveredTargetElement(null)
      }
    } else {
      setHoveredTargetElement(null)
    }
  }, [])

  // Update annotation (edit mode submit)
  const updateAnnotation = useCallback(
    (newComment: string) => {
      if (pendingAnnotation?.state !== 'edit') {
        return
      }

      const updatedAnnotation = { ...pendingAnnotation, comment: newComment }

      setAnnotations((prev) =>
        prev.map((a) => (a.id === pendingAnnotation.id ? updatedAnnotation : a)),
      )

      // Fire callback
      onAnnotationUpdate?.(updatedAnnotation)
      void fireWebhook('annotation.update', { annotation: updatedAnnotation })

      // Sync update to server (non-blocking)
      if (endpoint) {
        updateAnnotationOnServer(endpoint, pendingAnnotation.id, {
          comment: newComment,
        }).catch((error) => {
          console.warn('[Agentation] Failed to update annotation on server:', error)
        })
      }

      // Animate out the edit popup
      setEditExiting(true)
      originalSetTimeout(() => {
        setPendingAnnotation(null)
        setEditingTargetElement(null)

        setEditExiting(false)
      }, 150)
    },
    [pendingAnnotation, onAnnotationUpdate, fireWebhook, endpoint],
  )

  // Cancel editing with exit animation
  const cancelEditAnnotation = useCallback(() => {
    setEditExiting(true)
    originalSetTimeout(() => {
      setPendingAnnotation(null)
      setEditingTargetElement(null)

      setEditExiting(false)
    }, 150)
  }, [])

  // Clear all with staggered animation
  const clearAll = useCallback(() => {
    const count = annotations.length

    if (count === 0) {
      return
    }

    // Fire callback with all annotations before clearing
    onAnnotationsClear?.(annotations)
    void fireWebhook('annotations.clear', { annotations })

    // Sync deletions to server (non-blocking)
    if (endpoint) {
      void Promise.all(
        annotations.map((a) =>
          deleteAnnotationFromServer(endpoint, a.id).catch((error) => {
            console.warn('[Agentation] Failed to delete annotation from server:', error)
          }),
        ),
      )
    }

    setIsClearing(true)

    // Clear draw strokes
    setDrawStrokes([])

    clearWireframeState(pathname)

    const totalAnimationTime = count * 30 + 200
    originalSetTimeout(() => {
      setAnnotations([])
      setAnimatedMarkers(new Set()) // Reset animated markers
      localStorage.removeItem(getStorageKey(pathname))
      setIsClearing(false)
    }, totalAnimationTime)
  }, [pathname, annotations, onAnnotationsClear, fireWebhook, endpoint])

  // Copy output
  const copyOutput = useCallback(async () => {
    const output = generateOutput(
      annotations.filter((item) => !item.archivedAt),
      window.location.pathname + window.location.search,
      settings.outputDetail,
    )

    if (copyToClipboard) {
      try {
        await navigator.clipboard.writeText(output)
      } catch {
        // Clipboard may fail (permissions, not HTTPS, etc.) - continue anyway
      }
    }

    // Fire callback with markdown output (always, regardless of clipboard success)
    onCopy?.(output)

    setCopied(true)
    originalSetTimeout(() => setCopied(false), 2000)

    if (settings.autoClearAfterCopy) {
      originalSetTimeout(() => clearAll(), 500)
    }
  }, [
    annotations,
    settings.outputDetail,
    settings.autoClearAfterCopy,
    clearAll,
    copyToClipboard,
    onCopy,
  ])

  // Send to webhook
  const sendToWebhook = useCallback(async () => {
    const displayUrl =
      typeof window !== 'undefined'
        ? window.location.pathname + window.location.search + window.location.hash
        : pathname
    let output = generateOutput(annotations, displayUrl, settings.outputDetail)
    if (!output) {
      output = `## Page Feedback: ${displayUrl}\n`
    }

    // Fire onSubmit callback
    if (onSubmit) {
      onSubmit(output, annotations)
    }

    // Start sending (arrow fades)
    setSendState({ action: 'webhook', state: 'sending' })

    // Brief delay for the fade effect
    await new Promise((resolve) => originalSetTimeout(resolve, 150))

    // Fire webhook and check result (force=true to bypass webhooksEnabled check for manual sends)
    const success = await fireWebhook('submit', { annotations, output }, true)

    // Show result

    setSendState({ state: success ? 'sent' : 'failed' })
    originalSetTimeout(() => setSendState({ state: 'idle' }), 2500)

    // Clear annotations if send succeeded and autoClearAfterCopy is enabled
    if (success && settings.autoClearAfterCopy) {
      originalSetTimeout(() => clearAll(), 500)
    }
  }, [
    onSubmit,
    fireWebhook,
    annotations,

    pathname,
    settings.outputDetail,

    settings.autoClearAfterCopy,
    clearAll,
  ])

  // Send to Payload
  const sendToPayload = useCallback(
    async (action: 'publish' | 'save' | null) => {
      const groups = new Map<string, { annotations: Annotation[]; owner: PayloadCMSDocument }>()
      for (const annotation of annotations) {
        if (!annotation.payloadCMS.path) {
          continue
        }
        const owner = annotation.payloadCMS.document ?? documentInfo
        const key = documentKey(owner)
        const group = groups.get(key) ?? { annotations: [], owner }
        group.annotations.push(annotation)
        groups.set(key, group)
      }
      if (!groups.size) {
        return
      }
      const output = JSON.stringify(annotations)
      const requestAction = hasDrafts ? action : 'save'
      if (!output) {
        return
      }

      // Fire onSubmit callback
      if (onSubmit) {
        onSubmit(output, annotations)
      }

      // Start sending (arrow fades)
      setSendState({
        action,
        state: 'sending',
      })

      // Brief delay for the fade effect
      await new Promise((resolve) => originalSetTimeout(resolve, 150))

      try {
        for (const { annotations: changes, owner } of groups.values()) {
          const response = await fetch(`${apiRoute}/payload-visual-editor`, {
            body: JSON.stringify({
              id: owner.id,
              action: requestAction,
              collection: owner.collection,
              locale: owner.locale,
              patches: generatePatches(changes),
            }),
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
            },
            method: 'POST',
          })
          if (!response.ok) {
            const payload = (await response.json().catch(() => null)) as { error?: string } | null
            throw new Error(
              `${owner.collection}: ${payload?.error ?? 'Unable to send visual editor patches'}. Earlier documents may already have been saved.`,
            )
          }
        }

        setSendState({ state: 'sent' })
        // Release image previews before the server component merge.
        flushSync(() =>
          setAnnotations((current) =>
            current.flatMap((item) => {
              if (!annotations.includes(item) || !item.payloadCMS.path) {
                return [item]
              }
              return requestAction === 'publish' ? [] : [{ ...item, media: undefined }]
            }),
          ),
        )
        await refreshPreview()
        originalSetTimeout(() => setSendState({ action: null, state: 'idle' }), 2500)
      } catch (error) {
        console.warn('Failed to send visual editor patches:', error)
        setSelectionNotice(error instanceof Error ? error.message : 'Unable to save changes')
        setSendState({ state: 'failed' })
        originalSetTimeout(() => {
          setSendState({ action: null, state: 'idle' })
        }, 2500)
      }
    },
    [onSubmit, apiRoute, annotations, documentInfo, hasDrafts, refreshPreview],
  )

  // Toolbar dragging - mousemove and mouseup
  useEffect(() => {
    if (!dragStartPos) {
      return
    }

    const DRAG_THRESHOLD = 10 // pixels

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartPos.x
      const deltaY = e.clientY - dragStartPos.y
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)

      // Start dragging once threshold is exceeded
      if (!isDraggingToolbar && distance > DRAG_THRESHOLD) {
        setIsDraggingToolbar(true)
      }

      if (isDraggingToolbar || distance > DRAG_THRESHOLD) {
        // Calculate new position
        let newX = dragStartPos.toolbarX + deltaX
        let newY = dragStartPos.toolbarY + deltaY

        // Constrain to viewport
        const padding = 20
        const wrapperWidth = 337 // .toolbar wrapper width
        const toolbarHeight = 44

        // Content is right-aligned within wrapper via margin-left: auto
        // Calculate content width based on state
        const contentWidth = isActive ? (connectionStatus === 'connected' ? 297 : 257) : 44 // collapsed circle

        // Content offset from wrapper left edge
        const contentOffset = wrapperWidth - contentWidth

        // Min X: content left edge >= padding
        const minX = padding - contentOffset
        // Max X: wrapper right edge <= viewport - padding
        const maxX = window.innerWidth - padding - wrapperWidth

        newX = Math.max(minX, Math.min(maxX, newX))
        newY = Math.max(padding, Math.min(window.innerHeight - toolbarHeight - padding, newY))

        setToolbarPosition({ x: newX, y: newY })
      }
    }

    const handleMouseUp = () => {
      // If we were actually dragging, set flag to prevent click event
      if (isDraggingToolbar) {
        justFinishedToolbarDragRef.current = true
      }
      setIsDraggingToolbar(false)
      setDragStartPos(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragStartPos, isDraggingToolbar, isActive, connectionStatus])

  // Handle toolbar drag start
  const handleToolbarMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only drag when clicking the toolbar background (not buttons or settings)
      if (
        (e.target as HTMLElement).closest('button') ||
        (e.target as HTMLElement).closest('[data-agentation-settings-panel]')
      ) {
        return
      }

      // Don't prevent default yet - let onClick work for collapsed state

      // Get toolbar parent's actual current position (toolbarPosition is applied to parent)
      const toolbarParent = (e.currentTarget as HTMLElement).parentElement
      if (!toolbarParent) {
        return
      }

      const rect = toolbarParent.getBoundingClientRect()
      const currentX = toolbarPosition?.x ?? rect.left
      const currentY = toolbarPosition?.y ?? rect.top

      setDragStartPos({
        toolbarX: currentX,
        toolbarY: currentY,
        x: e.clientX,
        y: e.clientY,
      })
      // Don't set isDraggingToolbar yet - wait for actual movement
    },
    [toolbarPosition],
  )

  // Keep toolbar in view on window resize and when toolbar expands/collapses
  useEffect(() => {
    if (!toolbarPosition) {
      return
    }

    const constrainPosition = () => {
      const padding = 20
      const wrapperWidth = 337 // .toolbar wrapper width
      const toolbarHeight = 44

      let newX = toolbarPosition.x
      let newY = toolbarPosition.y

      // Content is right-aligned within wrapper via margin-left: auto
      // Calculate content width based on state
      const contentWidth = isActive ? (connectionStatus === 'connected' ? 297 : 257) : 44 // collapsed circle

      // Content offset from wrapper left edge
      const contentOffset = wrapperWidth - contentWidth

      // Min X: content left edge >= padding
      const minX = padding - contentOffset
      // Max X: wrapper right edge <= viewport - padding
      const maxX = window.innerWidth - padding - wrapperWidth

      newX = Math.max(minX, Math.min(maxX, newX))
      newY = Math.max(padding, Math.min(window.innerHeight - toolbarHeight - padding, newY))

      // Only update if position changed
      if (newX !== toolbarPosition.x || newY !== toolbarPosition.y) {
        setToolbarPosition({ x: newX, y: newY })
      }
    }

    // Constrain immediately when isActive changes or on mount
    constrainPosition()

    window.addEventListener('resize', constrainPosition)
    return () => window.removeEventListener('resize', constrainPosition)
  }, [toolbarPosition, isActive, connectionStatus])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (
        workspace &&
        !pendingAnnotation &&
        (e.key === 'Escape' ||
          (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'e'))
      ) {
        e.preventDefault()
        window.parent.postMessage(
          { type: e.key === 'Escape' ? 'visual-editor:escape' : 'visual-editor:toggle' },
          window.location.origin,
        )
        return
      }
      if (workspace && e.key === 'Escape' && pendingAnnotation) {
        e.preventDefault()
        if (pendingAnnotation.state === 'edit') cancelEditAnnotation()
        else cancelAnnotation()
        return
      }
      if (e.key === 'Escape') {
        // Reset mode first
        setMode('arrange')
        // Clear multi-select if active
        if (pendingMultiSelectElements.length > 0) {
          setPendingMultiSelectElements([])
          return
        }
        if (pendingAnnotation?.state === 'pending') {
          // Let popup handle
        } else if (isActive) {
          hideTooltipsUntilMouseLeave()
          setIsActive(false)
        }
      }

      // Cmd+Shift+F / Ctrl+Shift+F to toggle feedback mode
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        hideTooltipsUntilMouseLeave()
        if (isActive) {
          deactivate()
        } else {
          setIsActive(true)
        }
        return
      }

      // Skip other shortcuts if typing or modifier keys are held
      if (isTyping || e.metaKey || e.ctrlKey) {
        return
      }

      // "P" to toggle pause/freeze
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        hideTooltipsUntilMouseLeave()
        setMode('arrange')
      }

      // "H" to toggle marker visibility
      if (e.key === 'h' || e.key === 'H') {
        if (annotations.length > 0) {
          e.preventDefault()
          hideTooltipsUntilMouseLeave()
          setShowMarkers((prev) => !prev)
        }
      }

      // "C" to copy output
      if (e.key === 'c' || e.key === 'C') {
        if (annotations.length > 0) {
          e.preventDefault()
          hideTooltipsUntilMouseLeave()
          void copyOutput()
        }
      }

      // "X" to clear all
      if (e.key === 'x' || e.key === 'X') {
        if (annotations.length > 0) {
          e.preventDefault()
          hideTooltipsUntilMouseLeave()
          clearAll()
        }
      }

      // "S" to send annotations
      if (e.key === 's' || e.key === 'S') {
        const hasValidWebhook = isValidUrl(settings.webhookUrl) || isValidUrl(webhookUrl || '')
        if (annotations.length > 0 && hasValidWebhook && sendState.state === 'idle') {
          e.preventDefault()
          hideTooltipsUntilMouseLeave()
          void sendToWebhook()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    workspace,
    cancelAnnotation,
    cancelEditAnnotation,
    isActive,
    deactivate,
    pendingAnnotation,
    annotations.length,
    settings.webhookUrl,
    webhookUrl,
    sendState,
    sendToWebhook,
    copyOutput,
    clearAll,
    pendingMultiSelectElements,
  ])

  useEffect(() => {
    if (!workspace) {
      return
    }
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== window.parent ||
        event.data?.type !== 'visual-editor:set-mode'
      ) {
        return
      }
      const next = event.data.mode
      if (!['annotate', 'browse', 'edit'].includes(next)) {
        return
      }
      setIsActive(next !== 'browse')
      setMode(next === 'annotate' ? 'annotate' : 'arrange')
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [workspace])

  useEffect(() => {
    workspace?.onModeChange(!isActive ? 'browse' : isArrangeMode ? 'edit' : 'annotate')
  }, [isActive, isArrangeMode, workspace])

  useEffect(() => {
    if (workspace)
      window.parent.postMessage(
        {
          type: 'visual-editor:annotations',
          count: annotations.filter((item) => !item.archivedAt && !item.payloadCMS.path).length,
        },
        window.location.origin,
      )
  }, [workspace, annotations])

  useEffect(() => {
    if (!workspace) return
    window.parent.postMessage(
      { type: 'visual-editor:annotation-selection', selected: Boolean(pendingAnnotation) },
      window.location.origin,
    )
    const receive = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === window.parent &&
        event.data?.type === 'visual-editor:cancel-annotation'
      ) {
        if (pendingAnnotation?.state === 'edit') cancelEditAnnotation()
        else cancelAnnotation()
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [workspace, pendingAnnotation?.id, cancelAnnotation, cancelEditAnnotation])

  if (!mounted) {
    return null
  }
  if (isToolbarHidden && !workspace) {
    return null
  }

  const hasAnnotations = annotations.length > 0
  // const webhookButtonState = activePayloadAction ? 'idle' : sendState
  const webhookButtonState = sendState.state

  // Filter annotations for rendering (exclude exiting ones from normal flow)
  const visibleAnnotations = annotations.filter(
    (a) =>
      !a.archivedAt &&
      !exitingMarkers.has(a.id) &&
      a.kind !== 'placement' &&
      a.kind !== 'rearrange',
  )
  const feedbackNotes = annotations.filter(
    (item) =>
      !item.payloadCMS.path &&
      !exitingMarkers.has(item.id) &&
      item.kind !== 'placement' &&
      item.kind !== 'rearrange',
  )
  const archivedNotes = feedbackNotes.filter((item) => item.archivedAt)
  const activeNotes = feedbackNotes.filter((item) => !item.archivedAt)
  const displayedNotes = annotationTab === 'archived' ? archivedNotes : activeNotes
  const hasVisibleAnnotations = visibleAnnotations.length > 0
  const exitingAnnotationsList = annotations.filter((a) => exitingMarkers.has(a.id))

  // Helper function to calculate viewport-aware tooltip positioning
  const getTooltipPosition = (annotation: Annotation): React.CSSProperties => {
    // Tooltip dimensions (from CSS)
    const tooltipMaxWidth = 200
    const tooltipEstimatedHeight = 80 // Estimated max height
    const markerSize = 22
    const gap = 10

    // Convert percentage-based x to pixels
    const markerX = (annotation.x / 100) * window.innerWidth
    const markerY = typeof annotation.y === 'string' ? parseFloat(annotation.y) : annotation.y

    const styles: React.CSSProperties = {}

    // Vertical positioning: flip if near bottom
    const spaceBelow = window.innerHeight - markerY - markerSize - gap
    if (spaceBelow < tooltipEstimatedHeight) {
      // Show above marker
      styles.top = 'auto'
      styles.bottom = `calc(100% + ${gap}px)`
    }
    // If enough space below, use default CSS (top: calc(100% + 10px))

    // Horizontal positioning: adjust if near edges
    const centerX = markerX - tooltipMaxWidth / 2
    const edgePadding = 10

    if (centerX < edgePadding) {
      // Too close to left edge
      const offset = edgePadding - centerX
      styles.left = `calc(50% + ${offset}px)`
    } else if (centerX + tooltipMaxWidth > window.innerWidth - edgePadding) {
      // Too close to right edge
      const overflow = centerX + tooltipMaxWidth - (window.innerWidth - edgePadding)
      styles.left = `calc(50% - ${overflow}px)`
    }
    // If centered position is fine, use default CSS (left: 50%)

    return styles
  }

  return createPortal(
    <div
      data-agentation-accent={settings.annotationColorId}
      data-agentation-root=""
      data-theme={isDarkMode ? 'dark' : 'light'}
      ref={portalWrapperRef}
      style={{ display: 'contents' }}
    >
      <ArrangeEditor
        actionsContainer={workspace?.actionsContainer}
        contextActionsContainer={workspace?.contextActionsContainer}
        active={isActive && isArrangeMode}
        adminRoute={adminRoute}
        apiRoute={apiRoute}
        documentInfo={documentInfo}
        onComment={(element, label) => {
          const rect = element.getBoundingClientRect()
          const isFixed = isElementFixed(element)
          const top = Math.max(0, rect.top)
          setMode('annotate')
          setHoverInfo(null)
          setPendingAnnotation({
            id: Date.now().toString(),
            accessibility: getAccessibilityInfo(element),
            boundingBox: {
              height: rect.height,
              width: rect.width,
              x: rect.left,
              y: isFixed ? rect.top : rect.top + window.scrollY,
            },
            clientY: top,
            comment: '',
            computedStyles: getForensicComputedStyles(element),
            computedStylesObj: getDetailedComputedStyles(element),
            cssClasses: getElementClasses(element),
            element: label,
            elementPath: getFullElementPath(element),
            fullPath: getFullElementPath(element),
            isFixed,
            nearbyElements: getNearbyElements(element),
            nearbyText: getNearbyText(element),
            payloadCMS: { path: '', value: '' },
            sourceFile: detectSourceFile(element),
            state: 'pending',
            targetElement: element,
            timestamp: Date.now(),
            x: ((rect.left + Math.min(24, rect.width / 2)) / window.innerWidth) * 100,
            y: isFixed ? top : top + window.scrollY,
          })
        }}
        onClose={() =>
          workspace
            ? window.parent.postMessage({ type: 'visual-editor:collapse' }, window.location.origin)
            : setIsActive(false)
        }
        onReveal={
          workspace
            ? () =>
                window.parent.postMessage({ type: 'visual-editor:reveal' }, window.location.origin)
            : undefined
        }
        onHome={
          workspace
            ? () =>
                window.parent.postMessage({ type: 'visual-editor:home' }, window.location.origin)
            : undefined
        }
        headerContainer={workspace?.headerContainer}
        historyContainer={workspace?.historyContainer}
        onPendingChange={workspace?.onPendingChange}
        panelContainer={workspace?.panelContainer}
      />
      {richTextTarget && (
        <RichTextDialog
          adminRoute={adminRoute}
          documentInfo={richTextTarget.document}
          onClose={() => setRichTextTarget(null)}
          path={richTextTarget.path}
        />
      )}

      {mediaTarget && (
        <MediaPicker
          adminRoute={adminRoute}
          apiRoute={apiRoute}
          documentInfo={mediaTarget.document}
          onClose={() => setMediaTarget(null)}
          onSelect={(media) => {
            const { document: owner, element, path } = mediaTarget
            const matches = (item: Annotation) =>
              item.payloadCMS.path === path &&
              documentKey(item.payloadCMS.document ?? documentInfo) === documentKey(owner)
            const rect = element.getBoundingClientRect()
            const existing = annotations.find(matches)
            const annotation: Annotation = {
              id: existing?.id || `media-${Date.now()}`,
              comment: media.filename || 'Replace image',
              element: `Image ${path}`,
              elementPath: path,
              media,
              payloadCMS: { document: owner, path, value: String(media.id) },
              timestamp: Date.now(),
              x: (rect.left / window.innerWidth) * 100,
              y: rect.top + window.scrollY,
            }
            setAnnotations((current) => [...current.filter((item) => !matches(item)), annotation])
            setMediaTarget(null)
          }}
          path={mediaTarget.path}
        />
      )}
      {selectionNotice && (
        <div
          data-annotation-popup
          role="status"
          style={{
            background: '#171717',
            borderRadius: 8,
            bottom: 90,
            color: '#fff',
            fontSize: 14,
            left: '50%',
            padding: 16,
            position: 'fixed',
            transform: 'translateX(-50%)',
            width: 'min(420px, 90vw)',
            zIndex: 100001,
          }}
        >
          {selectionNotice}
          <button
            onClick={() => setSelectionNotice('')}
            style={{ display: 'block', marginTop: 8 }}
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}
      {workspace &&
        createPortal(
          <section aria-label="Page annotations" data-feedback-toolbar>
            {pendingAnnotation ? (
              <AnnotationEditor
                key={pendingAnnotation.id}
                comment={pendingAnnotation.comment}
                element={annotationLabel(pendingAnnotation.element)}
                editing={pendingAnnotation.state === 'edit'}
                onCancel={
                  pendingAnnotation.state === 'edit' ? cancelEditAnnotation : cancelAnnotation
                }
                onSubmit={pendingAnnotation.state === 'edit' ? updateAnnotation : addAnnotation}
              />
            ) : (
              <>
                <div
                  className={annotationStyles.annotationTabs}
                  role="group"
                  aria-label="Note views"
                >
                  <button
                    type="button"
                    aria-pressed={annotationTab === 'active'}
                    onClick={() => setAnnotationTab('active')}
                  >
                    Active ({activeNotes.length})
                  </button>
                  <button
                    type="button"
                    aria-pressed={annotationTab === 'archived'}
                    onClick={() => setAnnotationTab('archived')}
                  >
                    Archived ({archivedNotes.length})
                  </button>
                </div>
                <p className={annotationStyles.annotationHint}>
                  Click anywhere on the page to leave a note.
                </p>
                <nav aria-label="Annotation actions" className={annotationStyles.annotationTools}>
                  <button
                    type="button"
                    disabled={!hasAnnotations}
                    onClick={() => setShowMarkers(!showMarkers)}
                  >
                    {showMarkers ? 'Hide markers' : 'Show markers'}
                  </button>
                  <details className={annotationStyles.annotationOptions}>
                    <summary>More options</summary>
                    <div>
                      <button
                        type="button"
                        disabled={!hasAnnotations}
                        onClick={() => void copyOutput()}
                      >
                        {copied ? 'Copied' : 'Copy feedback'}
                      </button>
                      <button type="button" onClick={() => setShowSettings(!showSettings)}>
                        Annotation settings
                      </button>
                      <button
                        type="button"
                        disabled={!activeNotes.length}
                        onClick={() =>
                          setAnnotations((items) =>
                            items.map((item) =>
                              !item.payloadCMS.path && !item.archivedAt
                                ? { ...item, archivedAt: new Date().toISOString() }
                                : item,
                            ),
                          )
                        }
                      >
                        Resolve all notes
                      </button>
                    </div>
                  </details>
                </nav>
                {displayedNotes.map((annotation) => (
                  <article key={annotation.id} className={annotationStyles.annotationCard}>
                    <header className={annotationStyles.annotationCardHeader}>
                      <span className={annotationStyles.annotationTarget}>
                        <span className={annotationStyles.annotationNumber}>
                          {displayedNotes.findIndex((item) => item.id === annotation.id) + 1}
                        </span>
                        {annotationLabel(annotation.element)}
                      </span>
                      {annotation.ticket && (
                        <a
                          className={annotationStyles.annotationTicket}
                          href={annotation.ticket.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ticket ${annotation.ticket.identifier}`}
                        >
                          {annotation.ticket.identifier} <span aria-hidden="true">↗</span>
                        </a>
                      )}
                    </header>
                    <p className={annotationStyles.annotationComment}>{annotation.comment}</p>
                    {(!annotation.ticket || annotation.ticket.screenshotError) &&
                    annotation.ticketRequest ? (
                      <div aria-live="polite">
                        {sendingTickets.has(annotation.id) ? (
                          <p>Sending feedback…</p>
                        ) : (
                          <>
                            <p role={annotation.ticketError ? 'alert' : undefined}>
                              {annotation.ticketError || 'Not submitted.'}
                            </p>
                            <button
                              type="button"
                              onClick={() => void sendAnnotationTicket(annotation)}
                            >
                              {annotation.ticket ? 'Retry screenshot' : 'Retry submission'}
                            </button>
                          </>
                        )}
                      </div>
                    ) : null}

                    {ticketDeleteErrors[annotation.id] && (
                      <p role="alert">{ticketDeleteErrors[annotation.id]}</p>
                    )}
                    <nav className={annotationStyles.annotationCardActions}>
                      {!annotation.ticketRequest && (
                        <button type="button" onClick={() => startEditAnnotation(annotation)}>
                          Edit note
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={
                          deletingTickets.has(annotation.id) || sendingTickets.has(annotation.id)
                        }
                        onClick={() => archiveAnnotation(annotation.id, !annotation.archivedAt)}
                      >
                        {annotation.archivedAt ? 'Restore' : 'Resolve'}
                      </button>
                      {annotation.ticket && deleteAnnotationTicket && (
                        <button
                          type="button"
                          disabled={
                            deletingTickets.has(annotation.id) || sendingTickets.has(annotation.id)
                          }
                          onClick={() => void removeTicket(annotation)}
                        >
                          {deletingTickets.has(annotation.id) ? 'Deleting…' : 'Delete ticket'}
                        </button>
                      )}
                    </nav>
                  </article>
                ))}
                {!displayedNotes.length && (
                  <p>{annotationTab === 'archived' ? 'No archived notes.' : 'No active notes.'}</p>
                )}
                {showSettings && (
                  <SettingsPanel
                    connectionStatus={connectionStatus}
                    endpoint={endpoint}
                    isDarkMode
                    isDevMode={isDevMode}
                    isVisible
                    onHideToolbar={() =>
                      window.parent.postMessage(
                        { type: 'visual-editor:collapse' },
                        window.location.origin,
                      )
                    }
                    onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
                    onSettingsPageChange={setSettingsPage}
                    onToggleTheme={toggleTheme}
                    settings={settings}
                    settingsPage={settingsPage}
                    toolbarNearBottom={false}
                  />
                )}
              </>
            )}
          </section>,
          workspace.annotationContainer,
        )}
      {/* Toolbar */}
      <div
        className={`${styles.toolbar} ${userClassName ? ` ${userClassName}` : ''}`}
        data-agentation-toolbar
        data-feedback-toolbar
        style={{
          display: workspace ? 'none' : undefined,
          ...(toolbarPosition
            ? {
                bottom: 'auto',
                left: toolbarPosition.x,
                right: 'auto',
                top: toolbarPosition.y,
              }
            : undefined),
          width: isArrangeMode ? '301px' : isEditCmsMode ? '420px' : '301px',
        }}
      >
        {/* Morphing container */}
        <div
          className={`${styles.toolbarContainer} ${isActive ? styles.expanded : styles.collapsed} ${showEntranceAnimation ? styles.entrance : ''} ${isToolbarHiding ? styles.hiding : ''} ${!settings.webhooksEnabled && (isValidUrl(settings.webhookUrl) || isValidUrl(webhookUrl || '')) ? styles.serverConnected : ''}`}
          onClick={
            !isActive
              ? (e) => {
                  // Don't activate if we just finished dragging
                  if (justFinishedToolbarDragRef.current) {
                    justFinishedToolbarDragRef.current = false
                    e.preventDefault()
                    return
                  }
                  setIsActive(true)
                }
              : undefined
          }
          onKeyDown={() => {}}
          onMouseDown={handleToolbarMouseDown}
          role={!isActive ? 'button' : undefined}
          style={{
            width: isActive ? (isEditCmsMode ? '420px' : '301px') : undefined,
          }}
          tabIndex={!isActive ? 0 : -1}
          title={!isActive ? 'Edit content' : undefined}
        >
          {/* Toggle content - visible when collapsed */}
          <div className={`${styles.toggleContent} ${!isActive ? styles.visible : styles.hidden}`}>
            <IconListSparkle size={24} />
            {hasVisibleAnnotations && (
              <span
                className={`${styles.badge} ${isActive ? styles.fadeOut : ''} ${showEntranceAnimation ? styles.entrance : ''}`}
              >
                {visibleAnnotations.length}
              </span>
            )}
          </div>

          {/* Controls content - visible when expanded */}
          <div
            className={`${styles.controlsContent}
              ${isActive ? styles.visible : styles.hidden}
              ${
                toolbarPosition && toolbarPosition.y < 100 ? styles.tooltipBelow : ''
              } ${tooltipsHidden || showSettings ? styles.tooltipsHidden : ''} ${tooltipSessionActive ? styles.tooltipsInSession : ''}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                handleControlsMouseEnter()
              }
            }}
            onMouseEnter={handleControlsMouseEnter}
            onMouseLeave={handleControlsMouseLeave}
          >
            <div
              className={`${styles.buttonWrapper} ${toolbarPosition && toolbarPosition.x < 120 ? styles.buttonWrapperAlignLeft : ''}`}
              id="toggle-annotate-mode"
            >
              <button
                className={`${styles.controlButton} `}
                data-active={isAnnotateMode}
                onClick={(e) => {
                  e.stopPropagation()
                  hideTooltipsUntilMouseLeave()
                  setMode((prev) => (prev === 'annotate' ? 'arrange' : 'annotate'))
                }}
                type="button"
              >
                <IconEdit size={24} />
              </button>
              <span className={styles.buttonTooltip}>
                {isAnnotateMode ? 'Exit annotate mode' : 'Annotate mode'}
                <span className={styles.shortcut}>P</span>
              </span>
            </div>

            <div className={styles.buttonWrapper}>
              <button
                aria-label={isArrangeMode ? 'Inline editing' : 'Edit content'}
                aria-pressed={isArrangeMode}
                className={styles.controlButton}
                data-active={isArrangeMode}
                onClick={() => {
                  setPendingAnnotation(null)
                  setHoverInfo(null)
                  setMode(isArrangeMode && !workspace ? 'editCMS' : 'arrange')
                }}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  fill="none"
                  height="24"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  viewBox="0 0 24 24"
                  width="24"
                >
                  <rect height="7" rx="2" width="13" x="8" y="3" />
                  <rect height="7" rx="2" width="13" x="8" y="14" />
                  <path d="M3 4v5m-2-3 2-2 2 2M3 15v5m-2-2 2 2 2-2" />
                </svg>
              </button>
              <span className={styles.buttonTooltip}>
                {isArrangeMode ? 'Inline editing' : 'Edit content'}
              </span>
            </div>
            <div className={styles.buttonWrapper} id="toggle-marker-visibility">
              <button
                className={`${styles.controlButton} `}
                disabled={!hasAnnotations}
                onClick={(e) => {
                  e.stopPropagation()
                  hideTooltipsUntilMouseLeave()
                  setShowMarkers(!showMarkers)
                }}
                type="button"
              >
                <IconEyeAnimated isOpen={showMarkers} size={24} />
              </button>
              <span className={styles.buttonTooltip}>
                {showMarkers ? 'Hide markers' : 'Show markers'}
                <span className={styles.shortcut}>H</span>
              </span>
            </div>

            <div className={styles.buttonWrapper} id="copy-markers">
              <button
                className={`${styles.controlButton}  ${copied ? styles.statusShowing : ''}`}
                data-active={copied}
                disabled={!hasAnnotations}
                onClick={(e) => {
                  e.stopPropagation()
                  hideTooltipsUntilMouseLeave()
                  void copyOutput()
                }}
                type="button"
              >
                <IconCopyAnimated copied={copied} size={24} />
              </button>
              <span className={styles.buttonTooltip}>
                Copy feedback
                <span className={styles.shortcut}>C</span>
              </span>
            </div>

            <div className={styles.buttonWrapper} id="clear-markers">
              <button
                className={`${styles.controlButton}`}
                data-danger
                disabled={!hasAnnotations}
                onClick={(e) => {
                  e.stopPropagation()
                  hideTooltipsUntilMouseLeave()
                  clearAll()
                }}
                type="reset"
              >
                <IconTrashAlt size={24} />
              </button>
              <span className={styles.buttonTooltip}>
                Clear all
                <span className={styles.shortcut}>X</span>
              </span>
            </div>

            {isEditCmsMode && hasDrafts && (
              <div className={`${styles.buttonWrapper}`} id="save-draft">
                <button
                  aria-label="Save"
                  className={`${styles.controlButton} ${styles.actionButton} ${styles.saveActionButton} ${sendState.action === 'save' && ['failed', 'sent'].includes(sendState.state) ? styles.statusShowing : ''}`}
                  data-active={sendState.action === 'save' && sendState.state === 'sending'}
                  data-error={sendState.action === 'save' && sendState.state === 'failed'}
                  data-no-hover={
                    sendState.action === 'save' &&
                    (sendState.state === 'sent' || sendState.state === 'failed')
                  }
                  disabled={!hasAnnotations || sendState.state === 'sending'}
                  onClick={(e) => {
                    e.stopPropagation()
                    hideTooltipsUntilMouseLeave()
                    void sendToPayload('save')
                  }}
                  type="button"
                >
                  <span className={styles.actionButtonText}>Save</span>
                </button>
                <span className={styles.buttonTooltip}>Save</span>
              </div>
            )}

            {isArrangeMode ? null : isEditCmsMode ? (
              <div className={`${styles.buttonWrapper}`} id={hasDrafts ? 'publish' : 'save'}>
                <button
                  aria-label={hasDrafts ? 'Publish' : 'Save'}
                  className={`${styles.controlButton} ${styles.actionButton} ${hasDrafts ? styles.publishActionButton : styles.saveActionButton} ${sendState.action === 'publish' && (sendState.state === 'sent' || sendState.state === 'failed') ? styles.statusShowing : ''}`}
                  data-active={sendState.action === 'publish' && sendState.state === 'sending'}
                  data-error={sendState.action === 'publish' && sendState.state === 'failed'}
                  data-no-hover={
                    sendState.action === 'publish' &&
                    (sendState.state === 'sent' || sendState.state === 'failed')
                  }
                  disabled={!hasAnnotations || sendState.state === 'sending'}
                  onClick={(e) => {
                    e.stopPropagation()
                    hideTooltipsUntilMouseLeave()
                    void sendToPayload('publish')
                  }}
                  type="button"
                >
                  <span className={styles.actionButtonText}>{hasDrafts ? 'Publish' : 'Save'}</span>
                  {hasAnnotations && sendState.state === 'idle' && (
                    <span className={styles.buttonBadge}>{annotations.length}</span>
                  )}
                </button>
                <span className={styles.buttonTooltip}>{hasDrafts ? 'Publish' : 'Save'}</span>
              </div>
            ) : (
              <div
                className={`${styles.buttonWrapper}
                  ${styles.sendButtonWrapper} ${isActive && !settings.webhooksEnabled && (isValidUrl(settings.webhookUrl) || isValidUrl(webhookUrl || '')) ? styles.sendButtonVisible : styles.sendButtonHidden}`}
                id="submit"
              >
                <button
                  className={`${styles.controlButton} ${webhookButtonState === 'sent' || webhookButtonState === 'failed' ? styles.statusShowing : ''}`}
                  data-no-hover={webhookButtonState === 'sent' || webhookButtonState === 'failed'}
                  disabled={
                    !hasAnnotations ||
                    (!isValidUrl(settings.webhookUrl) && !isValidUrl(webhookUrl || '')) ||
                    webhookButtonState === 'sending'
                  }
                  onClick={(e) => {
                    e.stopPropagation()
                    hideTooltipsUntilMouseLeave()
                    void sendToWebhook()
                  }}
                  tabIndex={
                    isValidUrl(settings.webhookUrl) || isValidUrl(webhookUrl || '') ? 0 : -1
                  }
                  type="button"
                >
                  <IconSendArrow size={24} state={webhookButtonState} />
                  {hasAnnotations && webhookButtonState === 'idle' && (
                    <span className={styles.buttonBadge}>{annotations.length}</span>
                  )}
                </button>
                <span className={styles.buttonTooltip}>
                  Send Annotations
                  <span className={styles.shortcut}>S</span>
                </span>
              </div>
            )}

            <div className={styles.buttonWrapper} id="settings">
              <button
                className={`${styles.controlButton} `}
                onClick={(e) => {
                  e.stopPropagation()
                  hideTooltipsUntilMouseLeave()
                  setMode('arrange')
                  setShowSettings(!showSettings)
                }}
                type="button"
              >
                <IconGear size={24} />
              </button>
              {endpoint && connectionStatus !== 'disconnected' && (
                <span
                  className={`${styles.mcpIndicator} ${styles[connectionStatus]} ${showSettings ? styles.hidden : ''}`}
                  title={connectionStatus === 'connected' ? 'MCP Connected' : 'MCP Connecting...'}
                />
              )}
              <span className={styles.buttonTooltip}>Settings</span>
            </div>

            <div className={styles.divider} />

            <div
              className={`${styles.buttonWrapper}

                ${
                  toolbarPosition &&
                  typeof window !== 'undefined' &&
                  toolbarPosition.x > window.innerWidth - 120
                    ? styles.buttonWrapperAlignRight
                    : ''
                }`}
            >
              <button
                className={`${styles.controlButton} `}
                onClick={(e) => {
                  e.stopPropagation()
                  hideTooltipsUntilMouseLeave()
                  deactivate()
                }}
                type="button"
              >
                <IconXmarkLarge size={24} />
              </button>
              <span className={styles.buttonTooltip}>
                Exit
                <span className={styles.shortcut}>Esc</span>
              </span>
            </div>
          </div>

          {/* layout mode Palette - removed */}

          <SettingsPanel
            connectionStatus={connectionStatus}
            endpoint={endpoint}
            isDarkMode={isDarkMode}
            isDevMode={isDevMode}
            isVisible={showSettingsVisible}
            onHideToolbar={hideToolbarTemporarily}
            onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
            onSettingsPageChange={setSettingsPage}
            onToggleTheme={toggleTheme}
            settings={settings}
            settingsPage={settingsPage}
            toolbarNearBottom={!!toolbarPosition && toolbarPosition.y < 230}
          />
        </div>
      </div>
      {/* Blank canvas backdrop — stays mounted so opacity transition works on open/close - removed */}
      {/* design mode overlay — passthrough when no component selected - removed*/}
      {/* Rearrange overlay — always active alongside design overlay - removed*/}
      {/* Draw canvas — outside overlay so it can fade on toolbar close - removed*/}

      {/* Markers layer - normal scrolling markers */}
      <div className={styles.markersLayer} data-feedback-toolbar>
        {markersVisible &&
          visibleAnnotations
            .filter((a) => !a.isFixed)
            .map((annotation, layerIndex, arr) => (
              <AnnotationMarker
                annotation={annotation}
                globalIndex={visibleAnnotations.findIndex((a) => a.id === annotation.id)}
                isAnimated={animatedMarkers.has(annotation.id)}
                isClearing={isClearing}
                isDeleting={deletingMarkerId === annotation.id}
                isEditingAny={!!(pendingAnnotation?.state === 'edit')}
                isExiting={markersExiting}
                isHovered={!markersExiting && hoveredMarkerId === annotation.id}
                key={annotation.id}
                layerIndex={layerIndex}
                layerSize={arr.length}
                markerClickBehavior={settings.markerClickBehavior}
                onClick={(a) =>
                  settings.markerClickBehavior === 'delete'
                    ? deleteAnnotation(a.id)
                    : startEditAnnotation(a)
                }
                onContextMenu={startEditAnnotation}
                onHoverEnter={(a) =>
                  !markersExiting && a.id !== recentlyAddedIdRef.current && handleMarkerHover(a)
                }
                onHoverLeave={() => handleMarkerHover(null)}
                renumberFrom={renumberFrom}
                tooltipStyle={getTooltipPosition(annotation)}
              />
            ))}
        {markersVisible &&
          !markersExiting &&
          exitingAnnotationsList
            .filter((a) => !a.isFixed)
            .map((a) => <ExitingMarker annotation={a} key={a.id} />)}
      </div>
      {/* Fixed markers layer */}
      <div className={styles.fixedMarkersLayer} data-feedback-toolbar>
        {markersVisible &&
          visibleAnnotations
            .filter((a) => a.isFixed)
            .map((annotation, layerIndex, arr) => (
              <AnnotationMarker
                annotation={annotation}
                globalIndex={visibleAnnotations.findIndex((a) => a.id === annotation.id)}
                isAnimated={animatedMarkers.has(annotation.id)}
                isClearing={isClearing}
                isDeleting={deletingMarkerId === annotation.id}
                isEditingAny={!!(pendingAnnotation?.state === 'edit')}
                isExiting={markersExiting}
                isHovered={!markersExiting && hoveredMarkerId === annotation.id}
                key={annotation.id}
                layerIndex={layerIndex}
                layerSize={arr.length}
                markerClickBehavior={settings.markerClickBehavior}
                onClick={(a) =>
                  settings.markerClickBehavior === 'delete'
                    ? deleteAnnotation(a.id)
                    : startEditAnnotation(a)
                }
                onContextMenu={startEditAnnotation}
                onHoverEnter={(a) =>
                  !markersExiting && a.id !== recentlyAddedIdRef.current && handleMarkerHover(a)
                }
                onHoverLeave={() => handleMarkerHover(null)}
                renumberFrom={renumberFrom}
                tooltipStyle={getTooltipPosition(annotation)}
              />
            ))}
        {markersVisible &&
          !markersExiting &&
          exitingAnnotationsList
            .filter((a) => a.isFixed)
            .map((a) => <ExitingMarker annotation={a} fixed key={a.id} />)}
      </div>
      {/* Interactive overlay */}
      {isActive && !isArrangeMode && (
        <div
          className={styles.overlay}
          data-feedback-toolbar
          style={pendingAnnotation || pendingAnnotation ? { zIndex: 99999 } : undefined}
        >
          {/* Hover highlight */}
          {hoverInfo?.rect && pendingAnnotation?.state !== 'pending' && !isScrolling && (
            <div
              className={`${styles.hoverHighlight} ${styles.enter}`}
              style={{
                backgroundColor:
                  'color-mix(in srgb, var(--agentation-color-accent) 4%, transparent)',
                borderColor: 'color-mix(in srgb, var(--agentation-color-accent) 50%, transparent)',
                height: hoverInfo.rect.height,
                left: hoverInfo.rect.left,
                top: hoverInfo.rect.top,
                width: hoverInfo.rect.width,
              }}
            />
          )}

          {/* Cmd+shift+click multi-select highlights (during selection, before releasing modifiers) - removed */}

          {/* Marker hover outline (shows bounding box of hovered annotation) */}
          {hoveredMarkerId &&
            pendingAnnotation?.state !== 'pending' &&
            (() => {
              const hoveredAnnotation = annotations.find((a) => a.id === hoveredMarkerId)
              if (!hoveredAnnotation?.boundingBox) {
                return null
              }

              // Render individual element boxes if available (cmd+shift+click multi-select)
              //removed

              // Single element: use live position from hoveredTargetElement when available
              const rect =
                hoveredTargetElement && document.contains(hoveredTargetElement)
                  ? hoveredTargetElement.getBoundingClientRect()
                  : null

              const bb = rect
                ? { height: rect.height, width: rect.width, x: rect.left, y: rect.top }
                : {
                    height: hoveredAnnotation.boundingBox.height,
                    width: hoveredAnnotation.boundingBox.width,
                    x: hoveredAnnotation.boundingBox.x,
                    y: hoveredAnnotation.isFixed
                      ? hoveredAnnotation.boundingBox.y
                      : hoveredAnnotation.boundingBox.y - scrollY,
                  }

              const isMulti = hoveredAnnotation.isMultiSelect
              return (
                <div
                  className={`${isMulti ? styles.multiSelectOutline : styles.singleSelectOutline} ${styles.enter}`}
                  style={{
                    height: bb.height,
                    left: bb.x,
                    top: bb.y,
                    width: bb.width,
                    ...(isMulti
                      ? {}
                      : {
                          backgroundColor:
                            'color-mix(in srgb, var(--agentation-color-accent) 5%, transparent)',
                          borderColor:
                            'color-mix(in srgb, var(--agentation-color-accent) 60%, transparent)',
                        }),
                  }}
                />
              )
            })()}

          {/* Hover tooltip */}
          {hoverInfo && pendingAnnotation?.state !== 'pending' && !isScrolling && (
            <div
              className={`${styles.hoverTooltip} ${styles.enter}`}
              style={{
                left: Math.max(8, Math.min(hoverPosition.x, window.innerWidth - 100)),
                top: Math.max(hoverPosition.y - (hoverInfo.reactComponents ? 48 : 32), 8),
              }}
            >
              {hoverInfo.reactComponents && (
                <div className={styles.hoverReactPath}>{hoverInfo.reactComponents}</div>
              )}
              <div className={styles.hoverElementName}>{hoverInfo.elementName}</div>
            </div>
          )}

          {/* Pending annotation marker + popup */}
          {!workspace && pendingAnnotation?.state === 'pending' && (
            <>
              {/* Show element/area outline while adding annotation */}
              {pendingAnnotation.multiSelectElements?.length
                ? // Cmd+shift+click multi-select: show individual boxes with live positions
                  pendingAnnotation.multiSelectElements
                    .filter((el) => document.contains(el))
                    .map((el, index) => {
                      const rect = el.getBoundingClientRect()
                      return (
                        <div
                          className={`${styles.multiSelectOutline} ${pendingExiting ? styles.exit : styles.enter}`}
                          key={`pending-multi-${index}`}
                          style={{
                            height: rect.height,
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                          }}
                        />
                      )
                    })
                : // Single element or drag multi-select: show single box
                  pendingAnnotation.targetElement &&
                    document.contains(pendingAnnotation.targetElement)
                  ? // Single-click: use live getBoundingClientRect for consistent positioning
                    (() => {
                      const rect = pendingAnnotation.targetElement.getBoundingClientRect()
                      return (
                        <div
                          className={`${styles.singleSelectOutline} ${pendingExiting ? styles.exit : styles.enter}`}
                          style={{
                            backgroundColor:
                              'color-mix(in srgb, var(--agentation-color-accent) 5%, transparent)',
                            borderColor:
                              'color-mix(in srgb, var(--agentation-color-accent) 60%, transparent)',
                            height: rect.height,
                            left: rect.left,
                            top: rect.top,
                            width: rect.width,
                          }}
                        />
                      )
                    })()
                  : // Drag selection or fallback: use stored boundingBox
                    pendingAnnotation.boundingBox && (
                      <div
                        className={`${pendingAnnotation.isMultiSelect ? styles.multiSelectOutline : styles.singleSelectOutline} ${pendingExiting ? styles.exit : styles.enter}`}
                        style={{
                          height: pendingAnnotation.boundingBox.height,
                          left: pendingAnnotation.boundingBox.x,
                          top: pendingAnnotation.boundingBox.y - scrollY,
                          width: pendingAnnotation.boundingBox.width,
                          ...(pendingAnnotation.isMultiSelect
                            ? {}
                            : {
                                backgroundColor:
                                  'color-mix(in srgb, var(--agentation-color-accent) 5%, transparent)',
                                borderColor:
                                  'color-mix(in srgb, var(--agentation-color-accent) 60%, transparent)',
                              }),
                        }}
                      />
                    )}

              {(() => {
                // Use stored coordinates - they match what will be saved
                const markerX = pendingAnnotation.x
                const markerY = pendingAnnotation.isFixed
                  ? pendingAnnotation.y
                  : pendingAnnotation.y - scrollY

                return (
                  <>
                    <PendingMarker
                      isExiting={pendingExiting}
                      isMultiSelect={pendingAnnotation.isMultiSelect}
                      x={markerX}
                      y={markerY}
                    />

                    <AnnotationPopupCSS
                      accentColor={
                        pendingAnnotation.isMultiSelect
                          ? 'var(--agentation-color-green)'
                          : 'var(--agentation-color-accent)'
                      }
                      computedStyles={pendingAnnotation.computedStylesObj}
                      element={annotationLabel(pendingAnnotation.element)}
                      isExiting={pendingExiting}
                      lightMode={!isDarkMode}
                      onCancel={cancelAnnotation}
                      onSubmit={addAnnotation}
                      placeholder={
                        pendingAnnotation.element === 'Area selection'
                          ? 'What should change in this area?'
                          : pendingAnnotation.isMultiSelect
                            ? 'Feedback for this group of elements...'
                            : 'What should change?'
                      }
                      ref={popupRef}
                      selectedText={pendingAnnotation.selectedText}
                      style={{
                        // Popup is 280px wide, centered with translateX(-50%), so 140px each side
                        // Clamp so popup stays 20px from viewport edges
                        left: Math.max(
                          160,
                          Math.min(window.innerWidth - 160, (markerX / 100) * window.innerWidth),
                        ),
                        // Position popup above or below marker to keep marker visible
                        ...(markerY > window.innerHeight - 290
                          ? { bottom: window.innerHeight - markerY + 20 }
                          : { top: markerY + 20 }),
                      }}
                    />
                  </>
                )
              })()}
            </>
          )}

          {/* Edit annotation popup */}
          {!workspace && pendingAnnotation?.state === 'edit' && (
            <>
              {/* Show element/area outline while editing */}
              {pendingAnnotation.elementBoundingBoxes?.length
                ? // Cmd+shift+click: show individual element boxes (use live rects when available)
                  (() => {
                    // Use live positions from editingTargetElements when available - removed
                    // Fallback to stored bounding boxes
                    return pendingAnnotation.elementBoundingBoxes.map((bb, index) => (
                      <div
                        className={`${styles.multiSelectOutline} ${styles.enter}`}
                        key={`edit-multi-${index}`}
                        style={{
                          height: bb.height,
                          left: bb.x,
                          top: bb.y - scrollY,
                          width: bb.width,
                        }}
                      />
                    ))
                  })()
                : // Single element or drag multi-select: show single box
                  (() => {
                    // Use live position from editingTargetElement when available
                    const rect =
                      editingTargetElement && document.contains(editingTargetElement)
                        ? editingTargetElement.getBoundingClientRect()
                        : null

                    const bb = rect
                      ? { height: rect.height, width: rect.width, x: rect.left, y: rect.top }
                      : pendingAnnotation.boundingBox
                        ? {
                            height: pendingAnnotation.boundingBox.height,
                            width: pendingAnnotation.boundingBox.width,
                            x: pendingAnnotation.boundingBox.x,
                            y: pendingAnnotation.isFixed
                              ? pendingAnnotation.boundingBox.y
                              : pendingAnnotation.boundingBox.y - scrollY,
                          }
                        : null

                    if (!bb) {
                      return null
                    }

                    return (
                      <div
                        className={`${pendingAnnotation.isMultiSelect ? styles.multiSelectOutline : styles.singleSelectOutline} ${styles.enter}`}
                        style={{
                          height: bb.height,
                          left: bb.x,
                          top: bb.y,
                          width: bb.width,
                          ...(pendingAnnotation.isMultiSelect
                            ? {}
                            : {
                                backgroundColor:
                                  'color-mix(in srgb, var(--agentation-color-accent) 5%, transparent)',
                                borderColor:
                                  'color-mix(in srgb, var(--agentation-color-accent) 60%, transparent)',
                              }),
                        }}
                      />
                    )
                  })()}

              <AnnotationPopupCSS
                accentColor={
                  pendingAnnotation.isMultiSelect
                    ? 'var(--agentation-color-green)'
                    : 'var(--agentation-color-accent)'
                }
                computedStyles={parseComputedStylesString(pendingAnnotation.computedStyles)}
                element={annotationLabel(pendingAnnotation.element)}
                initialValue={pendingAnnotation.comment}
                isExiting={editExiting}
                lightMode={!isDarkMode}
                onCancel={cancelEditAnnotation}
                onDelete={() => deleteAnnotation(pendingAnnotation.id)}
                onSubmit={updateAnnotation}
                placeholder="Edit your feedback..."
                ref={editPopupRef}
                selectedText={pendingAnnotation.selectedText}
                style={(() => {
                  const markerY = pendingAnnotation.isFixed
                    ? pendingAnnotation.y
                    : pendingAnnotation.y - scrollY
                  return {
                    // Popup is 280px wide, centered with translateX(-50%), so 140px each side
                    // Clamp so popup stays 20px from viewport edges
                    left: Math.max(
                      160,
                      Math.min(
                        window.innerWidth - 160,
                        (pendingAnnotation.x / 100) * window.innerWidth,
                      ),
                    ),
                    // Position popup above or below marker to keep marker visible
                    ...(markerY > window.innerHeight - 290
                      ? { bottom: window.innerHeight - markerY + 20 }
                      : { top: markerY + 20 }),
                  }
                })()}
                submitLabel="Save"
              />
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  )
}

export default VisualEditorToolbar
