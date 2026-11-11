import { type ReactNode, useId } from 'react'
import { EditorIcon } from '../workspace/icons.js'
import styles from './styles.module.scss'

export function RecoveryPanel({
  children,
  collapsed,
  heading,
  onToggle,
}: {
  children: ReactNode
  collapsed: boolean
  heading: ReactNode
  onToggle: () => void
}) {
  const id = useId()
  return (
    <section
      aria-label="Recover unsaved edits"
      className={`${styles.recovery} ${collapsed ? styles.recoveryCollapsed : ''}`}
    >
      <div className={styles.recoveryHeading}>
        <div className={styles.recoveryTitle}>
          {!collapsed && <strong>Unsaved edits</strong>}
          <button
            aria-label={collapsed ? 'Expand stored edits' : 'Minimize recovery panel'}
            aria-expanded={!collapsed}
            aria-controls={`${id}-heading ${id}-content`}
            className={styles.recoveryToggle}
            onClick={onToggle}
            type="button"
          >
            {collapsed ? (
              <>
                <span aria-hidden="true" className={styles.recoveryIndicator} />
                <span className={styles.recoveryLabel}>Unsaved edits</span>
                <span aria-hidden="true" className={styles.recoveryExpand} />
              </>
            ) : (
              <EditorIcon name="minus" />
            )}
          </button>
        </div>
        <div id={`${id}-heading`} hidden={collapsed} className={styles.recoveryHeading}>
          {heading}
        </div>
      </div>
      <div id={`${id}-content`} hidden={collapsed} className={styles.recoveryContent}>
        {children}
      </div>
    </section>
  )
}
