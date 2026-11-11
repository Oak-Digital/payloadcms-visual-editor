// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => vi.fn())
vi.mock('./screenshot.js', () => ({ screenshotStore: store }))
import { annotationTicketClient } from './client.js'
const annotation = {
  id: 'note',
  createdAt: Date.now(),
  comment: 'Fix',
  element: 'h1',
  elementPath: 'h1',
  url: 'http://localhost/page',
  document: { collection: 'pages', id: 'page', hasDrafts: true },
  x: 20,
  y: 40,
  screenshot: true,
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it('reuses original bytes and ticket identity after partial failure, including a new client', async () => {
  const blob = new Blob(['original image'], { type: 'image/jpeg' })
  store.mockResolvedValue(blob)
  const ticket = {
    identifier: 'REC-123',
    url: 'https://os.oak.dk/task/REC-123',
    screenshotError: 'Retry screenshot',
  }
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json(ticket))
    .mockResolvedValueOnce(
      Response.json({ ...ticket, screenshotError: undefined, screenshotUploaded: true }),
    )
  vi.stubGlobal('fetch', fetch)
  const partial = await annotationTicketClient('/api').submit(annotation)
  expect(partial.screenshotError).toBeTruthy()
  await annotationTicketClient('/api').submit(annotation, partial)
  const body = fetch.mock.calls[1][1].body as FormData
  expect(JSON.parse(String(body.get('annotation'))).identifier).toBe('REC-123')
  expect(await (body.get('screenshot') as File).text()).toBe('original image')
  // Retain bytes until deletion: a crash before saving the successful result must be retryable.
  expect(store.mock.calls).toEqual([['note'], ['note']])
})
it('does not recapture or submit when the original screenshot is missing', async () => {
  store.mockResolvedValue(undefined)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(annotationTicketClient('/api').submit(annotation)).rejects.toThrow(
    'original screenshot is missing',
  )
  expect(fetch).not.toHaveBeenCalled()
})
it('cleans up the screenshot only after confirmed ticket deletion', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 502 }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetch)
  const client = annotationTicketClient('/api')
  const ticket = { identifier: 'REC-123', url: 'https://os.oak.dk/task/REC-123' }
  await expect(client.delete(annotation, ticket)).rejects.toThrow()
  expect(store).not.toHaveBeenCalled()
  await client.delete(annotation, ticket)
  expect(store).toHaveBeenCalledWith('note', null)
})
