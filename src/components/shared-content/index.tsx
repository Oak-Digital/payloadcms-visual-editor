'use client'

import { useEffect, useRef, useState } from 'react'
import type {
  SharedNode,
  SharedOperation,
  SharedSnapshot,
  SharedTarget,
} from '../../utils/shared-content.js'
import { EditorIcon } from '../workspace/icons.js'
import styles from './styles.module.scss'

type Session = {
  target: SharedTarget
  base: SharedSnapshot
  snapshot: SharedSnapshot
  operations: SharedOperation[]
  undo: SharedOperation[][]
  redo: SharedOperation[][]
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
  hidden?: boolean
}) {
  const [sessions, setSessions] = useState<Record<string, Session>>({})
  const [layers, setLayers] = useState<Layer[]>([])
  const layerCache = useRef<Record<string, Layer[]>>({})
  const previousKey = useRef(keyOf(target))
  const titleRef = useRef<HTMLHeadingElement>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [review, setReview] = useState(false)
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
  const selectedNodes = current?.row
    ? node?.rows?.find((r) => r.id === current.row)?.children
    : node?.children
  const nodes = current ? (selectedNodes ?? []) : (session?.snapshot.nodes ?? [])
  const pending = Object.values(sessions).filter(
    (s) => s.operations.length || s.base.status === 'draft',
  )
  const dirty = Object.values(sessions).filter((s) => s.operations.length)
  useEffect(() => {
    onStateChange(dirty.length > 0, busy)
  }, [dirty.length, busy])
  const request = async (t: SharedTarget, body: Record<string, unknown>) => {
    const response = await fetch(`${apiRoute}/payload-visual-editor/shared-content`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...t, locale, ...body }),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || 'Unable to edit shared content')
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
        if (active)
          setSessions((all) => ({
            ...all,
            [key]: { target, base: snapshot, snapshot, operations: [], undo: [], redo: [] },
          }))
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
  const save = async (action: 'save' | 'publish') => {
    setBusy(true)
    setSaving(true)
    setError('')
    try {
      for (const s of action === 'save' ? dirty : pending) {
        const snapshot: SharedSnapshot = await request(s.target, {
          action,
          revision: s.base.revision,
          operations: s.operations,
        })
        setSessions((all) => ({
          ...all,
          [keyOf(s.target)]: { ...s, base: snapshot, snapshot, operations: [], undo: [], redo: [] },
        }))
        onPreview(s.target, snapshot.document)
      }
      setReview(false)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed. Remaining changes are retained.')
    } finally {
      setSaving(false)
      setBusy(false)
    }
  }
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
        <label className={styles.field} key={n.path}>
          <span>{n.label}</span>
          {n.type === 'checkbox' ? (
            <input
              type="checkbox"
              checked={Boolean(value(n))}
              onChange={(e) => setValue(n, e.target.checked)}
            />
          ) : n.options ? (
            <select value={String(value(n) ?? '')} onChange={(e) => setValue(n, e.target.value)}>
              <option value="">Select…</option>
              {n.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : n.type === 'textarea' ? (
            <textarea
              value={String(value(n) ?? '')}
              onChange={(e) => setValue(n, e.target.value)}
            />
          ) : (
            <input
              type={n.type === 'number' ? 'number' : n.type === 'email' ? 'email' : 'text'}
              value={String(value(n) ?? '')}
              onChange={(e) =>
                setValue(
                  n,
                  n.type === 'number'
                    ? e.target.value === ''
                      ? null
                      : Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}
        </label>
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
        {error && (
          <>
            <p role="alert">{error}</p>
            <button
              disabled={busy}
              onClick={() => {
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
            <p>Publish the full drafts of these shared items across the site.</p>
            {pending.map((s) => (
              <p key={keyOf(s.target)}>{s.target.label}</p>
            ))}
            <button className={styles.primary} disabled={busy} onClick={() => save('publish')}>
              Publish shared changes
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
            {fields(nodes)}
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
            {busy
              ? 'Updating…'
              : dirty.length
                ? `${dirty.length} shared ${dirty.length === 1 ? 'item' : 'items'} · Unsaved`
                : pending.length
                  ? 'Draft saved'
                  : 'No pending changes'}
          </span>
          <div>
            <button
              aria-label="Undo shared change"
              disabled={busy || !session?.undo.length}
              onClick={() => history('undo')}
            >
              ↶
            </button>
            <button
              aria-label="Redo shared change"
              disabled={busy || !session?.redo.length}
              onClick={() => history('redo')}
            >
              ↷
            </button>
          </div>
        </div>
        <div className={styles.inline}>
          <button
            disabled={busy || !dirty.length || dirty.some((s) => !s.base.drafts)}
            onClick={() => save('save')}
          >
            Save draft
          </button>
          <button
            className={styles.primary}
            disabled={busy || !pending.length}
            onClick={() => setReview(true)}
          >
            Publish all
          </button>
        </div>
      </footer>
    </section>
  )
}
