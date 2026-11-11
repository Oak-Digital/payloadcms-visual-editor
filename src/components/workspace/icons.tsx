import styles from './icons.module.scss'

const paths = {
  back: 'm14 5-7 7 7 7',
  chevron: 'm9 5 7 7-7 7',
  close: 'm6 6 12 12M18 6 6 18',
  minus: 'M5 12h14',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  edit: 'm15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14v6Z',
  comment: 'M20 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v9Z',
  history: 'M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  desktop: 'M3 4h18v13H3zM12 17v4M8 21h8',
  mobile: 'M7 2h10v20H7zM11 18h2',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  page: 'M5 2h9l5 5v15H5zM14 2v6h5M8 13h8M8 17h5',
  image: 'M3 3h18v18H3zM3 16l6-6 5 5 3-3 4 4M15 7h.01',
  text: 'M4 5h16M12 5v15M8 20h8',
  check: 'm5 12 4 4L19 6',
  undo: 'M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12',
  redo: 'm16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12',
  up: 'm6 15 6-6 6 6',
  down: 'm6 9 6 6 6-6',
  plus: 'M12 5v14M5 12h14',
  grip: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
  globe: 'M3 12h18M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c-5 5-5 13 0 18 5-5 5-13 0-18',
  link: 'm10 13 4-4M8 15l-2 2a3 3 0 0 1-4-4l5-5a3 3 0 0 1 4 0m2 5a3 3 0 0 0 4 0l5-5a3 3 0 0 0-4-4l-2 2',
} as const

export function EditorIcon({ name }: { name: keyof typeof paths }) {
  if (name in styles) {
    return <span aria-hidden="true" className={styles[name]} />
  }
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  )
}

export function OakMark() {
  return <span aria-label="Oak" className={styles.oak} role="img" />
}
