'use client'

import { Fragment } from 'react'

import type { FieldIssue } from '../../utils/editor-error.js'
import type { PublishReviewData } from '../../utils/publish-review.js'

import { readableLabel } from '../../utils/publish-review.js'
import { recoveryValue } from '../../utils/recovery.js'
import styles from './styles.module.scss'

export type PublishReviewItem = {
  collection: string
  error?: string
  fieldErrors?: FieldIssue[]
  key: string
  locale?: string
  pending: boolean
  status: 'failed' | 'published' | 'ready'
} & PublishReviewData

function groupChanges(changes: PublishReviewData['changes']) {
  const groups = new Map<string, { label: string; changes: PublishReviewData['changes'] }>()
  for (const change of changes) {
    const parts = (change.label || readableLabel(change.path)).split(' › ')
    const section = change.path.match(/^(layout\.\d+)(?:\.|$)/)
    const key = section?.[1] || change.path
    const label = section ? (parts[0] === 'Sections' ? parts[1] : parts[0]) : parts.join(' › ')
    const group = groups.get(key) || { label: label || 'Section', changes: [] }
    group.changes.push(change)
    groups.set(key, group)
  }
  return [...groups.entries()]
}

function groupIssues(issues: FieldIssue[]) {
  const paths = issues.map((issue) =>
    issue.label.includes(' > ')
      ? issue.label.split(' > ')
      : issue.label === issue.path
        ? issue.path.replace(/\.(\d+)/g, (_, index) => ` ${Number(index) + 1}`).split('.')
        : [issue.label],
  )
  let prefix = 0
  while (paths.every((parts) => parts.length - prefix > 2 && parts[prefix] === paths[0][prefix])) {
    prefix++
  }
  const groups = new Map<string, ({ field: string } & FieldIssue)[]>()
  issues.forEach((issue, index) => {
    const parts = paths[index]
      .slice(prefix)
      .map((part) =>
        part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase()),
      )
    const field = parts.pop() || 'Content'
    const group = parts.join(' › ')
    const entries = groups.get(group) ?? []
    if (!entries.some((entry) => entry.path === issue.path && entry.message === issue.message)) {
      entries.push({ ...issue, field })
    }
    groups.set(group, entries)
  })
  return [...groups]
}

export function PublishReview({
  failed = false,
  items,
  loading,
  onEdit,
}: {
  failed?: boolean
  items: PublishReviewItem[]
  loading: boolean
  onEdit: (item: PublishReviewItem) => void
}) {
  return (
    <section aria-label="Publish review" className={styles.review}>
      {loading ? (
        <p role="status">Preparing review…</p>
      ) : !items.length ? (
        <p>{failed ? 'Review unavailable. Refresh to retry.' : 'No changes to publish.'}</p>
      ) : (
        <>
          {items.length > 1 && <p>Review changes across {items.length} documents.</p>}
          {items.map((item) => {
            const groups = groupChanges(item.changes)
            return (
              <article aria-label={item.label} data-publish-status={item.status} key={item.key}>
                <h3 className={styles.documentTitle} title={item.label}>
                  {item.label}
                </h3>
                <div className={styles.metadata}>
                  <p>
                    {readableLabel(item.collection)} ·{' '}
                    {item.locale?.toUpperCase() || 'Default locale'}
                  </p>
                  <span className={styles.publicationStatus}>
                    {item.status === 'failed'
                      ? 'Not published'
                      : item.published || item.status === 'published'
                        ? 'Published'
                        : 'First publication'}
                  </span>
                </div>
                {item.availability && (
                  <p role="status">
                    {item.status === 'published'
                      ? item.availability.public
                        ? 'Public in this language'
                        : 'Published · Not public'
                      : item.availability.public
                        ? item.previousAvailability?.public
                          ? 'Will update the public page'
                          : 'Will become public in this language'
                        : item.previousAvailability?.public
                          ? 'Will become unavailable to visitors'
                          : 'Will remain unavailable to visitors'}
                    {item.availability.url && (
                      <>
                        <br />
                        <span>{item.availability.url}</span>
                      </>
                    )}
                  </p>
                )}
                {!!item.sharedFields?.length && (
                  <p>All languages: {item.sharedFields.join(', ')}</p>
                )}
                {item.pending && <p>Includes unsaved edits</p>}
                {item.collection !== 'pages' && (
                  <p>Shared content · applies wherever this document is used.</p>
                )}
                {!!item.usage?.usages.length && (
                  <details>
                    <summary>
                      Used on {item.usage.usages.length}
                      {item.usage.hasMore ? '+' : ''}{' '}
                      {item.usage.usages.length === 1 && !item.usage.hasMore ? 'page' : 'pages'}
                    </summary>
                    <ul>
                      {item.usage.usages.map((usage) => (
                        <li key={usage.id}>
                          {usage.label}
                          {usage.published ? ' · Published' : ' · Draft'}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {item.usage?.incomplete && <p>Some usage details are unavailable.</p>}
                {!item.changes.length && <p>No content differences.</p>}
                {!!item.changes.length && (
                  <p className={styles.sectionCount}>
                    {groups.length} {groups.length === 1 ? 'change' : 'changes'} to review
                  </p>
                )}
                {groups.map(([key, group], index) => (
                  <details className={styles.changeGroup} key={key}>
                    <summary aria-label={`${group.label}: Compare with published`}>
                      <span className={styles.number} aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className={styles.changeHeading}>
                        <strong title={group.label}>{group.label}</strong>
                        <small>
                          {group.changes
                            .map((change) =>
                              (change.label || readableLabel(change.path)).split(' › ').at(-1),
                            )
                            .join(', ')}
                        </small>
                      </span>
                      <span className={styles.chevron} aria-hidden="true" />
                    </summary>
                    <div className={styles.comparison}>
                      <span className={styles.comparisonLabel}>Compare with published</span>
                      {group.changes.map((change) => (
                        <div className={styles.change} key={change.path}>
                          <strong>
                            {(change.label || readableLabel(change.path)).split(' › ').at(-1)}
                          </strong>
                          <small>Published</small>
                          <ReviewValue value={change.before} empty="No previous content" />
                          <small>Draft</small>
                          <ReviewValue value={change.after} empty="Removed" />
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
                {item.error && (
                  <div className={styles.failure}>
                    <div role="alert">
                      {item.fieldErrors?.length ? (
                        <>
                          <p>Fix these fields before publishing:</p>
                          {groupIssues(item.fieldErrors).map(([group, issues]) => (
                            <div className={styles.issueGroup} key={group}>
                              {group && <strong>{group}</strong>}
                              <ul>
                                {issues.map((issue) => (
                                  <li key={`${issue.path}:${issue.message}`}>
                                    <span>{issue.field}:</span> {issue.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </>
                      ) : (
                        <p>{item.error}</p>
                      )}
                    </div>
                    <p>Your edits are kept.</p>
                    <button onClick={() => onEdit(item)} type="button">
                      Edit content
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </>
      )}
    </section>
  )
}

function ReviewValue({ value, empty }: { value: any; empty: string }) {
  if (value === undefined || value === null || value === '') return <p>{empty}</p>
  if (value?.root?.type === 'root') {
    return <div className={styles.content}>{renderNode(value.root)}</div>
  }
  return <pre>{recoveryValue(value)}</pre>
}

function renderNode(node: any): React.ReactNode {
  if (node.type === 'text') {
    let content: React.ReactNode = node.text
    if (node.format & 1) content = <b>{content}</b>
    if (node.format & 2) content = <em>{content}</em>
    if (node.format & 8) content = <u>{content}</u>
    if (node.format & 4) content = <s>{content}</s>
    if (node.format & 16) content = <code>{content}</code>
    if (node.format & 32) content = <sub>{content}</sub>
    if (node.format & 64) content = <sup>{content}</sup>
    return content
  }
  if (node.type === 'linebreak') return <br />
  const children = node.children?.map((child: any, index: number) => (
    <Fragment key={index}>{renderNode(child)}</Fragment>
  ))
  if (node.type === 'root') return children
  if (node.type === 'paragraph') return <p>{children}</p>
  if (node.type === 'heading') return <strong>{children}</strong>
  if (node.type === 'quote') return <blockquote>{children}</blockquote>
  if (node.type === 'list') return <div>{children}</div>
  if (node.type === 'listitem') return <div>• {children}</div>
  if (node.type === 'link' || node.type === 'autolink') return <u>{children}</u>
  return <p>{children || 'Embedded content updated — view on page.'}</p>
}
