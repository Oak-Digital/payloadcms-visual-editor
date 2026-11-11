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

export type CaptureBounds = { x: number; y: number; width: number; height: number }
export type CapturePoint = { x: number; y: number }

export function markerInCapture(
  point: CapturePoint,
  bounds: CaptureBounds,
  width: number,
  height: number,
) {
  return {
    x: ((point.x - bounds.x) / bounds.width) * width,
    y: ((point.y - bounds.y) / bounds.height) * height,
  }
}

export function drawScreenshotMarker(
  canvas: HTMLCanvasElement,
  point: CapturePoint,
  bounds: CaptureBounds,
) {
  const marker = markerInCapture(point, bounds, canvas.width, canvas.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Unable to draw the note marker.')
  context.save()
  // html2canvas leaves its crop translation and scale on the rendering context.
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.beginPath()
  context.arc(marker.x, marker.y, 9, 0, Math.PI * 2)
  context.fillStyle = '#3b82f6'
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = '#fff'
  context.stroke()
  context.restore()
}

export async function captureScreenshot(
  id: string,
  point: CapturePoint,
  area?: CaptureBounds,
): Promise<void> {
  // A saved capture always wins, including after a response was lost or the page reloaded.
  if (await screenshotStore(id)) return
  const bounds = area ?? {
    x: 0,
    y: 0,
    width: Math.max(document.documentElement.scrollWidth, window.innerWidth),
    height: Math.max(document.documentElement.scrollHeight, window.innerHeight),
  }
  const { default: html2canvas } = await import('html2canvas-pro')
  const canvas = await html2canvas(document.documentElement, {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    scale: Math.min(1, 1920 / bounds.width, 1920 / bounds.height),
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
  drawScreenshotMarker(canvas, point, bounds)
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
