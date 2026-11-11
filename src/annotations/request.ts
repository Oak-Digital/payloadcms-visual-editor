import type { PayloadRequest } from 'payload'

/** Bound multipart parsing even when Content-Length is absent or untrusted. */
export async function readAnnotationForm(req: PayloadRequest) {
  const limit = 11 * 1024 * 1024
  if (Number(req.headers.get('content-length')) > limit || !req.body)
    throw new Error('Invalid screenshot request')
  const reader = req.body.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        throw new Error('Screenshot request too large')
      }
      chunks.push(new Uint8Array(value))
    }
  } finally {
    reader.releaseLock()
  }
  return new Response(new Blob(chunks), { headers: req.headers }).formData()
}
