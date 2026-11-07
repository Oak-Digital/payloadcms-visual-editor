'use client'

import type { PublishReviewData } from '../../utils/publish-review.js'

import { recoveryValue } from '../../utils/recovery.js'
import styles from './styles.module.scss'

export type PublishReviewItem = {
  collection: string
  error?: string
  key: string
  locale?: string
  pending: boolean
  status: 'failed' | 'published' | 'ready'
} & PublishReviewData

export function PublishReview({
  failed = false,
  items,
  loading,
}: {
  failed?: boolean
  items: PublishReviewItem[]
  loading: boolean
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
            Review {items.length} document{items.length === 1 ? '' : 's'} before publishing.
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
              <details>
                <summary>Compare with published · {item.changes.length}</summary>
                {!item.changes.length && <p>No content differences.</p>}
                {item.changes.map((change) => (
                  <div className={styles.change} key={change.path}>
                    <strong>
                      {change.path
                        .replace(/\.(\d+)/g, (_, index) => ` ${Number(index) + 1}`)
                        .replaceAll('.', ' › ')
                        .replace(/([a-z])([A-Z])/g, '$1 $2')
                        .replace(/^./, (letter) => letter.toUpperCase())}
                    </strong>
                    <small>Published</small>
                    <pre>{change.before === undefined ? '—' : recoveryValue(change.before)}</pre>
                    <small>After publishing</small>
                    <pre>{change.after === undefined ? '—' : recoveryValue(change.after)}</pre>
                  </div>
                ))}
              </details>
              {item.error && <p role="alert">{item.error}</p>}
            </article>
          ))}
          <p>Publishes the selected locale and shared fields.</p>
        </>
      )}
    </section>
  )
}
