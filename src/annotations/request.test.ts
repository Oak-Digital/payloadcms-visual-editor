// @vitest-environment node
import { expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'
import { readAnnotationForm } from './request.js'
it('stops oversized chunked bodies without trusting Content-Length', async () => {
  let canceled = false
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024 * 1024))
    },
    cancel() {
      canceled = true
    },
  })
  await expect(
    readAnnotationForm({ body, headers: new Headers({ 'content-length': '1' }) } as PayloadRequest),
  ).rejects.toThrow('too large')
  expect(canceled).toBe(true)
})
