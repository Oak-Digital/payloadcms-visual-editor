const database = 'visual-editor-screenshots'

/** Keep binary snapshots outside annotation localStorage so retries reuse the same bytes. */
export async function screenshotStore(id: string, value?: Blob | null): Promise<Blob | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('images')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Unable to save the screenshot in this browser.'))
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('images', value === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('images')
      const request =
        value === undefined
          ? store.get(id)
          : value === null
            ? store.delete(id)
            : store.put(value, id)
      transaction.oncomplete = () => resolve(value === undefined ? request.result : undefined)
      transaction.onerror = transaction.onabort = () =>
        reject(new Error('Unable to save the screenshot in this browser.'))
    })
  } finally {
    db.close()
  }
}

export async function captureScreenshot(id: string): Promise<void> {
  // A saved capture always wins, including after a response was lost or the page reloaded.
  if (await screenshotStore(id)) return
  const { default: html2canvas } = await import('html2canvas-pro')
  const canvas = await html2canvas(document.documentElement, {
    x: window.scrollX,
    y: window.scrollY,
    width: window.innerWidth,
    height: window.innerHeight,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    scale: Math.min(1, 1920 / window.innerWidth, 1920 / window.innerHeight),
    useCORS: true,
    logging: false,
    ignoreElements: (element: Element) =>
      element.matches(
        '[data-feedback-toolbar], [data-annotation-popup], [data-agentation-toolbar]',
      ),
    onclone: (clone: Document) => {
      // The canvas renderer does not apply the browser's closed-details content hiding.
      clone
        .querySelectorAll<HTMLElement>('details:not([open]) > :not(summary)')
        .forEach((element) => {
          element.style.display = 'none'
        })
      // Never include entered credentials or form values in feedback screenshots.
      clone
        .querySelectorAll('input, textarea, select, [contenteditable="true"]')
        .forEach((element) => {
          element.replaceChildren()
          element.setAttribute('value', '')
          if ('value' in element) (element as HTMLInputElement).value = ''
        })
    },
  })
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (value) =>
        value
          ? resolve(value)
          : reject(new Error('Unable to capture the screenshot. Retry feedback.')),
      'image/jpeg',
      0.85,
    ),
  )
  if (blob.size > 10 * 1024 * 1024) throw new Error('Screenshot exceeds 10 MB.')
  await screenshotStore(id, blob)
}
