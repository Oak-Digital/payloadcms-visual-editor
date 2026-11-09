'use client'

import { type RefObject, useEffect, useRef, useState } from 'react'
import type {
  SharedNode,
  SharedOperation,
  SharedSnapshot,
  SharedTarget,
} from '../../utils/shared-content.js'
import { validSharedRecovery } from '../../utils/recovery-validation.js'
import {
  clearRecovery,
  readRecovery,
  recoveryValue,
  writeRecovery,
  type RecoveryRecord,
} from '../../utils/recovery.js'
import { EditorRequestError } from '../../utils/editor-error.js'
import { PublishReview, type PublishReviewItem } from '../publish-review/index.js'
import { EditorIcon } from '../workspace/icons.js'
import { SchemaFields } from '../schema-fields/index.js'
import { ScalarField } from '../schema-fields/scalar-field.js'
import { findFieldLayout } from '../../utils/field-layout.js'
import styles from './styles.module.scss'

type Session = {
  target: SharedTarget
  base: SharedSnapshot
  snapshot: SharedSnapshot
  operations: SharedOperation[]
  undo: SharedOperation[][]
  redo: SharedOperation[][]
}
function isRecoverySession(value: unknown): value is Session {
  return validSharedRecovery(value)
}
type Layer = { path: string; row?: string; label: string }
const keyOf = (t: SharedTarget) => `${t.global ? 'global' : 'collection'}:${t.slug}:${t.id ?? ''}`
const find = (nodes: SharedNode[], path: string): SharedNode | undefined => {
  for (const n of nodes) {
    if (n.path === path) return n
    const child =
      find(n.children ?? [], path) || n.rows?.map((r) => find(r.children, path)).find(Boolean)
    if (child) return child
  }
}

export function SharedContentEditor({
  target,
  locale,
  apiRoute,
  onClose,
  onCollapse,
  onPreview,
  onSaved,
  onStateChange,
  enabledSources,
  onOpen,
  hidden = false,
  navigationActions,
}: {
  target: SharedTarget
  locale?: string
  apiRoute: string
  onClose: () => void
  onCollapse: () => void
  onPreview: (target: SharedTarget, document: Record<string, any>, focusPath?: string) => void
  onSaved: () => void
  onStateChange: (pending: boolean, busy: boolean) => void
  enabledSources: { slug: string; label: string; global?: boolean }[]
  onOpen: (target: SharedTarget) => void
  navigationActions?: RefObject<{ save: () => Promise<boolean>; discard: () => boolean } | null>
  hidden?: boolean
}) {
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [recoveries, setRecoveries] = useState<
    Record<string, { record: RecoveryRecord<Session>; conflict: boolean }>
  >({})
  const unreadRecovery = useRef(new Set<string>())
  const [recoveryNotice, setRecoveryNotice] = useState('')
  const [layers, setLayers] = useState<Layer[]>([])
  const layerCache = useRef<Record<string, Layer[]>>({})
  const previousKey = useRef(keyOf(target))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [review, setReview] = useState(false)
  const [reviewItems, setReviewItems] = useState<PublishReviewItem[]>([])
  const [reviewFailed, setReviewFailed] = useState(false)
  const reviewSessions = useRef<Session[]>([])
  const [relation, setRelation] = useState<SharedNode>()
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1)
  const [relationTo, setRelationTo] = useState('')
  const [choices, setChoices] = useState<{ id: string; label: string }[]>([]),
    [hasNext, setHasNext] = useState(false)
  const [values, setValues] = useState<Record<string, unknown>>({})
  const generation = useRef(0)
  const key = keyOf(target),
    session = sessions[key]
  const current = layers.at(-1),
    node = current && session ? find(session.snapshot.nodes, current.path) : undefined
  const focusPath =
    current?.row && node?.rows
      ? `${current.path}.${node.rows.findIndex((r) => r.id === current.row)}`
      : current?.path
  const dirty = Object.values(sessions).filter((s) => s.operations.length)
  useEffect(() => {
    onStateChange(dirty.length > 0 || Object.keys(recoveries).length > 0, busy)
  }, [dirty.length, busy, recoveries])
  const recoveryScope = (s: Session) => ({
    api: apiRoute,
    user: s.base.recoveryUser || '',
    kind: 'shared' as const,
    document: keyOf(s.target),
    locale,
  })
  useEffect(() => {
    if (saving) return
    for (const [key, s] of Object.entries(sessions)) {
      if (!s.base.recoveryUser || recoveries[key] || unreadRecovery.current.has(key)) continue
      try {
        const stored = s.operations.length
          ? writeRecovery(window.localStorage, recoveryScope(s), s.base.revision, s)
          : clearRecovery(window.localStorage, recoveryScope(s))
        if (!stored)
          setRecoveryNotice('Browser recovery is unavailable. Save your draft before leaving.')
      } catch {
        setRecoveryNotice('Browser recovery is unavailable. Save your draft before leaving.')
      }
    }
  }, [sessions, recoveries, saving])
  const request = async (t: SharedTarget, body: Record<string, unknown>) => {
    const response = await fetch(`${apiRoute}/payload-visual-editor/shared-content`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...t, locale, ...body }),
    })
    const result = await response.json()
    if (!response.ok)
      throw new EditorRequestError(
        result.error || 'Unable to edit shared content',
        result.fieldErrors,
      )
    return result
  }
  useEffect(() => {
    layerCache.current[previousKey.current] = layers
    previousKey.current = key
    setLayers(layerCache.current[key] ?? [])
    setValues({})
    setRelation(undefined)
    setError('')
    setReview(false)
  }, [key])
  useEffect(() => {
    if (session) return
    let active = true
    setBusy(true)
    request(target, { action: 'read' })
      .then((snapshot: SharedSnapshot) => {
        if (active) {
          const loaded: Session = {
            target,
            base: snapshot,
            snapshot,
            operations: [],
            undo: [],
            redo: [],
          }
          if (snapshot.recoveryUser) {
            try {
              const result = readRecovery(
                window.localStorage,
                recoveryScope(loaded),
                snapshot.revision,
                isRecoverySession,
              )
              if (result.status === 'available' && keyOf(result.record.value.target) === key) {
                setRecoveries((all) => ({ ...all, [key]: result }))
              } else if (result.status !== 'empty') {
                unreadRecovery.current.add(key)
                setRecoveryNotice('Stored edits could not be read.')
              }
            } catch {
              setRecoveryNotice('Browser recovery is unavailable.')
            }
          }
          setSessions((all) => ({
            ...all,
            [key]: loaded,
          }))
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setBusy(false)
      })
    return () => {
      active = false
    }
  }, [key, session])
  useEffect(() => {
    if (!session) return
    const seq = ++generation.current
    if (!session.operations.length) {
      setBusy(false)
      onPreview(target, session.base.document, focusPath)
      return
    }
    setBusy(true)
    const timer = setTimeout(() => {
      request(target, {
        action: 'preview',
        revision: session.base.revision,
        operations: session.operations,
      })
        .then((snapshot: SharedSnapshot) => {
          if (generation.current !== seq) return
          setSessions((all) => ({ ...all, [key]: { ...all[key], snapshot } }))
          onPreview(target, snapshot.document, focusPath)
          setValues({})
          setError('')
        })
        .catch((e) => {
          if (generation.current === seq) setError(e.message)
        })
        .finally(() => {
          if (generation.current === seq) setBusy(false)
        })
    }, 250)
    return () => clearTimeout(timer)
  }, [key, session?.operations])
  useEffect(() => {
    if (!relation || !session) return
    let active = true
    request(target, {
      action: 'choices',
      path: relation.path,
      relationTo,
      search,
      page,
      operations: session.operations,
    })
      .then((result) => {
        if (active) {
          setChoices(result.choices)
          setHasNext(result.hasNext)
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [relation, relationTo, search, page])
  useEffect(() => {
    if (session && !hidden) onPreview(target, session.snapshot.document, focusPath)
  }, [key, focusPath, hidden])
  useEffect(() => {
    if (!dirty.length) return
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty.length])
  useEffect(() => {
    if (!hidden) titleRef.current?.focus({ preventScroll: true })
  }, [hidden, key, layers, relation, review])
  const back = () => {
    if (saving) return
    if (relation) {
      setRelation(undefined)
      return
    }
    if (review) {
      setReview(false)
      return
    }
    if (layers.length) setLayers((l) => l.slice(0, -1))
    else onClose()
  }
  useEffect(() => {
    if (hidden) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        back()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  })
  const change = (op: SharedOperation) => {
    generation.current++
    setBusy(true)
    setSessions((all) => {
      const s = all[key]
      return {
        ...all,
        [key]: {
          ...s,
          operations: [...s.operations, op],
          undo: [...s.undo, s.operations],
          redo: [],
        },
      }
    })
  }
  const setValue = (n: SharedNode, value: unknown) => {
    setValues((v) => ({ ...v, [n.path]: value }))
    change({ type: 'set', path: n.path, value })
  }
  const history = (direction: 'undo' | 'redo') => {
    setValues({})
    setSessions((all) => {
      const s = all[key],
        list = s[direction],
        next = list.at(-1)
      if (!next) return all
      return {
        ...all,
        [key]: {
          ...s,
          operations: next,
          [direction]: list.slice(0, -1),
          [direction === 'undo' ? 'redo' : 'undo']: [
            ...s[direction === 'undo' ? 'redo' : 'undo'],
            s.operations,
          ],
          ...(next.length ? {} : { snapshot: s.base }),
        },
      }
    })
  }
  const preparePublish = async () => {
    if (busy || saving || Object.keys(recoveries).length) return
    setReview(true)
    setBusy(true)
    setError('')
    setReviewItems([])
    setReviewFailed(false)
    try {
      const items: PublishReviewItem[] = []
      const prepared: Session[] = []
      for (const candidate of Object.values(sessions)) {
        const base = candidate.operations.length
          ? candidate.base
          : await request(candidate.target, { action: 'read' })
        const s = { ...candidate, base }
        const result = await request(s.target, {
          action: 'review',
          revision: base.revision,
          operations: s.operations,
        })
        if (!s.operations.length && result.published && !result.changes.length) continue
        prepared.push(structuredClone(s))
        items.push({
          ...result,
          key: keyOf(s.target),
          label: s.target.label,
          collection: s.target.slug,
          locale,
          pending: !!s.operations.length,
          status: 'ready',
        })
      }
      reviewSessions.current = prepared
      setReviewItems(items)
    } catch (cause) {
      setReviewFailed(true)
      setError(cause instanceof Error ? cause.message : 'Unable to prepare review')
    } finally {
      setBusy(false)
    }
  }
  const save = async (action: 'save' | 'publish') => {
    if (busy || saving || Object.keys(recoveries).length) return false
    if (action === 'save' && !dirty.length) return true
    if (
      action === 'publish' &&
      (!review || reviewFailed || !reviewItems.some((item) => item.status !== 'published'))
    )
      return false
    setBusy(true)
    setSaving(true)
    setError('')
    let activeKey: string | undefined
    let completed = 0
    try {
      for (const s of action === 'save' ? dirty : reviewSessions.current) {
        activeKey = keyOf(s.target)
        if (
          action === 'publish' &&
          reviewItems.find((item) => item.key === activeKey)?.status === 'published'
        )
          continue
        if (
          action === 'publish' &&
          JSON.stringify(s.operations) !== JSON.stringify(sessions[activeKey]?.operations)
        )
          throw new Error('Pending edits changed. Refresh the review.')
        const snapshot: SharedSnapshot = await request(s.target, {
          action,
          revision: s.base.revision,
          operations: s.operations,
        })
        try {
          clearRecovery(window.localStorage, recoveryScope(s))
        } catch {
          /* Saved successfully. */
        }
        setSessions((all) => ({
          ...all,
          [keyOf(s.target)]: { ...s, base: snapshot, snapshot, operations: [], undo: [], redo: [] },
        }))
        onPreview(s.target, snapshot.document)
        completed++
        if (action === 'publish')
          setReviewItems((items) =>
            items.map((item) =>
              item.key === keyOf(s.target)
                ? { ...item, status: 'published', error: undefined }
                : item,
            ),
          )
      }
      if (action === 'save') setReview(false)
      onSaved()
      return true
    } catch (e) {
      if (action === 'publish') {
        setReviewFailed(true)
        setReviewItems((items) =>
          items.map((item) =>
            item.key === activeKey
              ? {
                  ...item,
                  status: 'failed',
                  error: e instanceof Error ? e.message : 'Publish failed',
                  fieldErrors: e instanceof EditorRequestError ? e.fieldErrors : [],
                }
              : item,
          ),
        )
      }
      if (completed) onSaved()
      setError(
        action === 'publish' && activeKey
          ? ''
          : e instanceof Error
            ? e.message
            : 'Save failed. Remaining changes are retained.',
      )
      return false
    } finally {
      setSaving(false)
      setBusy(false)
    }
  }
  useEffect(() => {
    if (!navigationActions) return
    navigationActions.current = {
      save: () => save('save'),
      discard: () => {
        if (busy || saving) return false
        try {
          const success = Object.values(sessions).every(
            (s) => !s.base.recoveryUser || clearRecovery(window.localStorage, recoveryScope(s)),
          )
          if (success) {
            setRecoveries({})
            setSessions((all) =>
              Object.fromEntries(
                Object.entries(all).map(([key, s]) => [
                  key,
                  { ...s, snapshot: s.base, operations: [], undo: [], redo: [] },
                ]),
              ),
            )
            setValues({})
          }
          return success
        } catch {
          return false
        }
      },
    }
    return () => {
      navigationActions.current = null
    }
  })
  const rowLabel = (n: SharedNode) => (n.rows ? `${n.rows.length} items` : '')
  const value = (n: SharedNode) => (Object.hasOwn(values, n.path) ? values[n.path] : n.value)
  const openRelation = (n: SharedNode) => {
    setRelation(n)
    setRelationTo(n.relations?.[0] ?? '')
    setSearch('')
    setPage(1)
    setChoices([])
  }
  const fields = (list: SharedNode[]) =>
    list.map((n) => {
      if (n.children || n.rows)
        return (
          <button
            className={styles.row}
            key={n.path}
            onClick={() => setLayers((l) => [...l, { path: n.path, label: n.label }])}
          >
            <span>
              <strong>{n.label}</strong>
              <small>{rowLabel(n)}</small>
            </span>
            <EditorIcon name="chevron" />
          </button>
        )
      if (n.type === 'relationship') {
        const raw = value(n) as any,
          related = raw?.relationTo ?? n.relations?.[0],
          id = raw?.value ?? raw
        const enabled = enabledSources.find((s) => s.slug === related && !s.global)
        return (
          <div className={styles.field} key={n.path}>
            <span>{n.label}</span>
            <button className={styles.row} onClick={() => openRelation(n)}>
              {id ? n.displayValue || 'Selected content' : 'Select content'}
              <EditorIcon name="chevron" />
            </button>
            {id && (
              <div className={styles.inline}>
                <button onClick={() => setValue(n, null)}>Clear</button>
                {enabled && (
                  <button
                    onClick={() => onOpen({ slug: related, id: String(id), label: enabled.label })}
                  >
                    Edit selected content
                  </button>
                )}
              </div>
            )}
          </div>
        )
      }
      return (
        <ScalarField
          key={n.path}
          label={n.label}
          type={n.type}
          value={value(n)}
          options={n.options}
          hasMany={n.hasMany}
          disabled={saving}
          onChange={(value) => setValue(n, value)}
        />
      )
    })
  return (
    <section className={styles.editor} hidden={hidden} aria-label="Shared content editor">
      <header className={styles.header}>
        <button aria-label="Back" disabled={saving} onClick={back}>
          <EditorIcon name="back" />
        </button>
        <div>
          <h2 ref={titleRef} tabIndex={-1}>
            {relation
              ? 'Select content'
              : review
                ? 'Publish shared content'
                : (current?.label ?? target.label)}
          </h2>
          <small>Shared across the site</small>
        </div>
        <button aria-label="Collapse editor" onClick={onCollapse}>
          <EditorIcon name="minus" />
        </button>
      </header>
      <div
        className={styles.body}
        inert={saving}
        key={`${key}:${current?.path ?? ''}:${current?.row ?? ''}:${!!relation}:${review}`}
      >
        {recoveryNotice && <p role="status">{recoveryNotice}</p>}
        {recoveries[key] && session && (
          <section aria-label="Recover shared edits">
            <p>Unsaved edits · {new Date(recoveries[key].record.savedAt).toLocaleString()}</p>
            {recoveries[key].conflict && (
              <>
                <p>
                  This content has newer changes. Review your stored edits before discarding them.
                </p>
                <details>
                  <summary>Review stored edits</summary>
                  <ul>
                    {recoveries[key].record.value.operations.map((op, index) => (
                      <li key={index}>
                        {find(recoveries[key].record.value.snapshot.nodes, op.path)?.label ||
                          op.path}
                        :{' '}
                        {op.type === 'set'
                          ? recoveryValue(op.value)
                          : op.type === 'add'
                            ? 'Added item'
                            : op.type === 'remove'
                              ? 'Removed item'
                              : 'Moved item'}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            )}
            <button
              type="button"
              disabled={busy || recoveries[key].conflict || dirty.length > 0}
              onClick={() => {
                const restored = recoveries[key].record.value
                setSessions((all) => ({
                  ...all,
                  [key]: { ...restored, undo: [[], ...restored.undo] },
                }))
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
                  if (!clearRecovery(window.localStorage, recoveryScope(session))) {
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
              Discard stored edits
            </button>
          </section>
        )}
        {error && (
          <>
            <p role="alert">{error}</p>
            <button
              disabled={busy}
              onClick={() => {
                if (session?.base.recoveryUser) {
                  try {
                    if (!clearRecovery(window.localStorage, recoveryScope(session))) {
                      setRecoveryNotice('Stored edits could not be discarded.')
                      return
                    }
                  } catch {
                    setRecoveryNotice('Stored edits could not be discarded.')
                    return
                  }
                }
                unreadRecovery.current.delete(key)
                setRecoveries((all) => {
                  const next = { ...all }
                  delete next[key]
                  return next
                })
                generation.current++
                setSessions((all) => {
                  const next = { ...all }
                  delete next[key]
                  return next
                })
                setLayers([])
                setValues({})
                setError('')
              }}
            >
              Discard edits and reload
            </button>
          </>
        )}
        {!session && <p>{busy ? 'Loading…' : 'Content unavailable.'}</p>}
        {review ? (
          <>
            <PublishReview
              items={reviewItems}
              loading={busy && !saving}
              failed={reviewFailed}
              onEdit={(item) => {
                const session = sessions[item.key]
                if (!session) return
                setReview(false)
                onOpen(session.target)
              }}
            />
            <button disabled={busy} onClick={() => void preparePublish()}>
              Refresh review
            </button>
          </>
        ) : relation ? (
          <>
            {relation.relations!.length > 1 && (
              <label className={styles.field}>
                <span>Content type</span>
                <select
                  value={relationTo}
                  onChange={(e) => {
                    setRelationTo(e.target.value)
                    setPage(1)
                  }}
                >
                  {relation.relations!.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
            )}
            <input
              aria-label="Search related content"
              placeholder="Search content…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
            />
            {choices.map((c) => (
              <button
                className={styles.row}
                key={c.id}
                onClick={() => {
                  setValue(relation, relation.polymorphic ? { relationTo, value: c.id } : c.id)
                  setRelation(undefined)
                }}
              >
                {c.label}
              </button>
            ))}
            <div className={styles.inline}>
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>Page {page}</span>
              <button disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </>
        ) : node?.rows && !current?.row ? (
          <>
            {node.rows.map((r, i) => (
              <div className={styles.item} key={r.id}>
                <button
                  className={styles.row}
                  title={r.label}
                  onClick={() =>
                    setLayers((l) => [...l, { path: node.path, row: r.id, label: r.label }])
                  }
                >
                  <strong>{r.label}</strong>
                  <EditorIcon name="chevron" />
                </button>
                <div>
                  <button
                    disabled={busy || i === 0}
                    aria-label={`Move ${r.label} up`}
                    onClick={() => change({ type: 'move', path: node.path, id: r.id, to: i - 1 })}
                  >
                    ↑
                  </button>
                  <button
                    disabled={busy || i === node.rows!.length - 1}
                    aria-label={`Move ${r.label} down`}
                    onClick={() => change({ type: 'move', path: node.path, id: r.id, to: i + 1 })}
                  >
                    ↓
                  </button>
                </div>
              </div>
            ))}
            {(node.blocks ?? [{ value: undefined, label: 'item' }]).map((b) => (
              <button
                className={styles.row}
                key={b.value ?? 'row'}
                disabled={busy || (node.maxRows !== undefined && node.rows!.length >= node.maxRows)}
                onClick={() =>
                  change({
                    type: 'add',
                    path: node.path,
                    id: Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) =>
                      x.toString(16).padStart(2, '0'),
                    ).join(''),
                    blockType: b.value,
                  })
                }
              >
                + Add {b.label}
              </button>
            ))}
          </>
        ) : (
          <>
            {session && (
              <SchemaFields
                nodes={
                  focusPath
                    ? (findFieldLayout(session.snapshot.layout ?? [], focusPath)?.children ?? [])
                    : (session.snapshot.layout ?? [])
                }
                visible={(node) => Boolean(find(session.snapshot.nodes, node.path))}
                onOpen={(node) => setLayers((l) => [...l, { path: node.path, label: node.label }])}
                renderCollection={(node) => fields([find(session.snapshot.nodes, node.path)!])}
                renderField={(node) => {
                  const field = find(session.snapshot.nodes, node.path)
                  return field ? fields([field]) : null
                }}
              />
            )}
            {current?.row && node?.rows && (
              <button
                className={styles.danger}
                disabled={busy || node.rows.length <= (node.minRows ?? 0)}
                onClick={() => {
                  change({ type: 'remove', path: node.path, id: current.row! })
                  setLayers((l) => l.slice(0, -1))
                }}
              >
                Remove item
              </button>
            )}
          </>
        )}
      </div>
      <footer className={styles.footer}>
        <div className={styles.status}>
          <span role="status">
            {review &&
            reviewItems.length > 0 &&
            reviewItems.every((item) => item.status === 'published')
              ? 'All shared changes published.'
              : busy
                ? 'Updating…'
                : dirty.length
                  ? `${dirty.length} shared ${dirty.length === 1 ? 'item' : 'items'} · Unsaved`
                  : Object.values(sessions).some((s) => s.base.status === 'draft')
                    ? 'Draft saved'
                    : 'No pending changes'}
          </span>
          <div>
            <button
              aria-label="Undo shared change"
              disabled={busy || review || !session?.undo.length}
              onClick={() => history('undo')}
            >
              ↶
            </button>
            <button
              aria-label="Redo shared change"
              disabled={busy || review || !session?.redo.length}
              onClick={() => history('redo')}
            >
              ↷
            </button>
          </div>
        </div>
        <div className={styles.inline}>
          <button
            disabled={busy || review || !dirty.length || dirty.some((s) => !s.base.drafts)}
            onClick={() => save('save')}
          >
            Save draft
          </button>
          <button
            className={styles.primary}
            disabled={
              busy ||
              Object.keys(recoveries).length > 0 ||
              (review && (reviewFailed || !reviewItems.some((item) => item.status !== 'published')))
            }
            onClick={() => void (review ? save('publish') : preparePublish())}
          >
            {review ? 'Publish shared changes' : 'Publish all'}
          </button>
        </div>
      </footer>
    </section>
  )
}
