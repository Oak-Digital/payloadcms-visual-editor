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
          <p>
            {items.length === 1
              ? 'Review changes before publishing.'
              : `Review changes across ${items.length} documents.`}
          </p>
          {items.map((item) => (
            <article aria-label={item.label} data-publish-status={item.status} key={item.key}>
              <h3 title={item.label}>{item.label}</h3>
              <p>
                {item.collection
                  .replaceAll('-', ' ')
                  .replace(/^./, (letter) => letter.toUpperCase())}{' '}
                · {item.locale?.toUpperCase() || 'Default locale'}
              </p>
              <p>
                {item.status === 'published'
                  ? 'Published'
                  : item.status === 'failed'
                    ? 'Not published'
                    : item.published
                      ? 'Updates published content'
                      : 'First publication'}
                {item.status === 'ready'
                  ? ` · ${item.pending ? 'Includes unsaved edits' : 'Saved draft'}`
                  : ''}
              </p>
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
              {item.changes.map((change) => (
                <div className={styles.change} key={change.path}>
                  <strong>{change.label || readableLabel(change.path)}</strong>
                  <ReviewValue value={change.after} empty="Removed" />
                  <details>
                    <summary>Compare with published</summary>
                    <small>Published</small>
                    <ReviewValue value={change.before} empty="No previous content" />
                  </details>
                </div>
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
          ))}
          <p>Publishes the selected locale and shared fields.</p>
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
