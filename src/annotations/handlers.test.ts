// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PayloadRequest } from 'payload'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findByID: vi.fn(),
  fetch: vi.fn(),
  integration: vi.fn(),
  read: vi.fn(),
  decrypt: vi.fn(),
  options: vi.fn(),
}))
vi.mock('./settings.js', () => ({
  getAnnotationIntegration: mocks.integration,
  readAnnotationSettings: mocks.read,
  decryptApiKey: mocks.decrypt,
  getOakConnectionOptions: mocks.options,
}))
import { createAnnotationHandler, createAnnotationConnectionHandler } from './handlers.js'
async function payloadRequest(request: Request): Promise<PayloadRequest> {
  const { user } = await mocks.auth()
  return {
    url: request.url,
    headers: request.headers,
    json: () => request.json(),
    body: request.body,
    user,
    payload: {
      findByID: mocks.findByID,
      secret: 'secret',
      config: { admin: { user: 'users' }, localization: { localeCodes: ['en'] } },
    },
  } as unknown as PayloadRequest
}
const POST = async (request: Request) =>
  createAnnotationHandler({ pages: true }, 'submit')(await payloadRequest(request))
const DELETE = async (request: Request) =>
  createAnnotationHandler({ pages: true }, 'delete')(await payloadRequest(request))

const input = {
  createdAt: Date.now(),
  id: '4c89dc9c-0ed6-4e13-8bd7-d31a352e4554',
  comment: 'Fix this heading',
  element: 'h2',
  elementPath: 'main h2',
  url: 'http://localhost:3000/en/test?secret=omit',
  document: { collection: 'pages', id: 'page', locale: 'en' },
  x: 50,
  y: 200,
}
const request = (data: unknown = input, origin = 'http://localhost:3000') =>
  new Request('http://localhost:3000/api/payload-visual-editor/annotations', {
    method: 'POST',
    headers: { origin },
    body: JSON.stringify(data),
  })
describe('annotation ticket submission', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.integration.mockResolvedValue({
      key: 'test-key',
      projectId: 'project',
      bugLabelId: 'bug',
    })
    vi.stubGlobal('fetch', mocks.fetch)
    mocks.auth.mockResolvedValue({ user: { id: 'editor', collection: 'users' } })
    mocks.findByID.mockResolvedValue({ id: 'page' })
    mocks.fetch.mockImplementation(async () => Response.json({ data: { identifier: 'REC-123' } }))
  })
  it('creates a Bug in the configured project and returns its link', async () => {
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      identifier: 'REC-123',
      url: 'https://os.oak.dk/task/REC-123',
    })
    expect(mocks.findByID).toHaveBeenCalledWith(
      expect.objectContaining({
        overrideAccess: false,
        req: expect.objectContaining({ user: { id: 'editor', collection: 'users' } }),
        id: 'page',
        locale: 'en',
      }),
    )
    const options = mocks.fetch.mock.calls[0]?.[1]
    expect(JSON.parse(options.body)).toMatchObject({
      projectId: 'project',
      labelIds: ['bug'],
      title: input.comment,
    })
    expect(options.body).not.toContain('secret=omit')
    expect(JSON.parse(options.body).description).not.toContain('Position:')
  })
  it('keeps readable context separate from identifiers and preserves ticket deletion', async () => {
    mocks.findByID.mockResolvedValueOnce({ id: 'page', title: 'Our story' })
    await POST(
      request({
        ...input,
        element: '<RedirectBoundary> <InnerLayoutRouter> <EditorialMotion> h2 "Great success"',
        elementPath: 'layout.1.heading',
      }),
    )
    const { description } = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    const [summary, details] = description.split('<details>')
    expect(summary).toContain('**Page:** [Our story](http://localhost:3000/en/test)')
    expect(summary).toContain('**Language:** en')
    expect(summary).toContain('**Element:** Heading — “Great success”')
    expect(description).not.toMatch(/RedirectBoundary|InnerLayoutRouter|EditorialMotion|Position:/)
    expect(summary).not.toContain(input.id)
    expect(details).toContain('Selector: layout.1.heading')
    expect(details).toContain(`Annotation: ${input.id}`)
    expect(details).toContain('Document: pages/page (en)')
    mocks.fetch
      .mockResolvedValueOnce(ticketResponse({ description }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await DELETE(deletionRequest())).status).toBe(204)
  })
  it('uses the configured title field and escapes summary content', async () => {
    const req = await payloadRequest(request({ ...input, element: 'h2 "<success>"' }))
    req.payload.config.collections = [
      { slug: 'pages', admin: { useAsTitle: 'name' } },
    ] as typeof req.payload.config.collections
    mocks.findByID.mockResolvedValueOnce({ name: 'Story [draft]' })
    await createAnnotationHandler({ pages: true }, 'submit')(req)
    const { description } = JSON.parse(mocks.fetch.mock.calls[0][1].body)
    expect(description).toContain(String.raw`[Story \[draft\]]`)
    expect(description).toContain(String.raw`Heading — “\<success\>”`)
  })
  it('reuses the same idempotency key after an unknown outcome', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('timeout'))
    expect((await POST(request())).status).toBe(502)
    expect((await POST(request())).status).toBe(200)
    expect(mocks.fetch.mock.calls[0]?.[1].headers['Idempotency-Key']).toBe(
      mocks.fetch.mock.calls[1]?.[1].headers['Idempotency-Key'],
    )
  })
  it('rejects anonymous, cross-origin and inaccessible-page requests', async () => {
    expect((await POST(request(input, 'https://elsewhere.test'))).status).toBe(403)
    mocks.auth.mockResolvedValueOnce({ user: null })
    expect((await POST(request())).status).toBe(403)
    mocks.findByID.mockRejectedValueOnce(new Error('forbidden'))
    expect((await POST(request())).status).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('does not replay requests after Oak OS idempotency expires', async () => {
    expect(
      (await POST(request({ ...input, createdAt: Date.now() - 24 * 60 * 60 * 1000 }))).status,
    ).toBe(409)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('rejects collections outside the host allowlist', async () => {
    expect(
      await POST(request({ ...input, document: { ...input.document, collection: 'users' } })),
    ).toHaveProperty('status', 403)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('rejects unsupported owners, locales, invalid coordinates and external URLs', async () => {
    for (const data of [
      { ...input, document: { ...input.document, locale: 'bad' } },
      { ...input, x: 120 },
      { ...input, url: 'https://elsewhere.test' },
    ]) {
      expect((await POST(request(data))).status).toBe(400)
    }
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('reports missing configuration and upstream failures without exposing credentials', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response('private upstream error', { status: 403 }))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private upstream')
    mocks.integration.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(503)
  })
  const deletionRequest = () => request({ ...input, identifier: 'REC-123' })
  const ticketResponse = (overrides = {}) =>
    Response.json(
      {
        data: {
          id: 'task-id',
          identifier: 'REC-123',
          project: { id: 'project' },
          description: `Note\nDocument: pages/page (en)\nAnnotation: ${input.id}`,
          ...overrides,
        },
      },
      { headers: { etag: '"revision-1"' } },
    )
  it('deletes only the matching ticket using its current version', async () => {
    mocks.fetch
      .mockResolvedValueOnce(ticketResponse())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await DELETE(deletionRequest())).status).toBe(204)
    expect(mocks.fetch.mock.calls[1]).toEqual([
      'https://os.oak.dk/api/v1/tasks/task-id',
      expect.objectContaining({
        method: 'DELETE',
        headers: { Authorization: 'Bearer test-key', 'If-Match': '"revision-1"' },
      }),
    ])
  })
  it('rejects tickets outside the project or belonging to another annotation', async () => {
    for (const mismatch of [
      { project: { id: 'other' } },
      { description: 'unrelated' },
      { identifier: 'REC-456' },
    ]) {
      mocks.fetch.mockResolvedValueOnce(ticketResponse(mismatch))
      expect((await DELETE(deletionRequest())).status).toBe(403)
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
  })
  it('deletes a matching annotation with appended image Markdown', async () => {
    mocks.fetch
      .mockResolvedValueOnce(
        ticketResponse({
          description: `Note\nDocument: pages/page (en)\nAnnotation: ${input.id}\n\n![image.jpg](/api/files/image)`,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await DELETE(deletionRequest())).status).toBe(204)
  })
  it('does not accept partial annotation markers', async () => {
    mocks.fetch.mockResolvedValueOnce(
      ticketResponse({
        description: `Note\nDocument: pages/page (en)\nAnnotation: ${input.id}-other`,
      }),
    )
    expect((await DELETE(deletionRequest())).status).toBe(403)
  })
  const imageRequest = (
    overrides = {},
    file = new File(['jpeg'], 'screenshot.jpg', { type: 'image/jpeg' }),
  ) => {
    const form = new FormData()
    form.set('annotation', JSON.stringify({ ...input, screenshot: true, ...overrides }))
    form.set('screenshot', file)
    return new Request('http://localhost:3000/api/payload-visual-editor/annotations', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000' },
      body: form,
    })
  }
  it('uploads after creation and returns the ticket when upload is not confirmed', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ data: { id: 'task-id', identifier: 'REC-123' } }))
      .mockRejectedValueOnce(new Error('timeout'))
    const response = await POST(imageRequest())
    const ticket = await response.json()
    expect(response.status).toBe(200)
    expect(ticket).toMatchObject({
      identifier: 'REC-123',
      screenshotError: expect.stringContaining('Retry'),
    })
    const firstUpload = mocks.fetch.mock.calls[1]
    expect(firstUpload[0]).toBe('https://os.oak.dk/api/v1/tasks/task-id/images')
    expect(firstUpload[1].body).toBeInstanceOf(File)
    mocks.fetch
      .mockResolvedValueOnce(ticketResponse())
      .mockResolvedValueOnce(Response.json({ data: { id: 'image' } }))
    expect(
      await (await POST(imageRequest({ identifier: ticket.identifier }))).json(),
    ).toMatchObject({ screenshotUploaded: true })
    expect(mocks.fetch.mock.calls[2][1].method).toBeUndefined()
    expect(mocks.fetch.mock.calls[3][1].headers['Idempotency-Key']).toBe(
      firstUpload[1].headers['Idempotency-Key'],
    )
    expect(firstUpload[1].headers['Idempotency-Key']).not.toBe(
      mocks.fetch.mock.calls[0][1].headers['Idempotency-Key'],
    )
  })
  it('checks project and annotation ownership before retrying an upload', async () => {
    mocks.fetch.mockResolvedValueOnce(ticketResponse({ project: { id: 'other' } }))
    expect((await POST(imageRequest({ identifier: 'REC-123' }))).status).toBe(403)
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })
  it('does not recreate deleted tickets or upload expired retries', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect((await POST(imageRequest({ identifier: 'REC-123' }))).status).toBe(404)
    mocks.fetch.mockResolvedValueOnce(ticketResponse())
    expect(
      await (
        await POST(
          imageRequest({ identifier: 'REC-123', createdAt: Date.now() - 24 * 60 * 60 * 1000 }),
        )
      ).json(),
    ).toMatchObject({ screenshotError: expect.stringContaining('expired') })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it('rejects missing, unsupported and oversized screenshots before creating a ticket', async () => {
    expect((await POST(request({ ...input, screenshot: true }))).status).toBe(400)
    expect(
      (await POST(imageRequest({}, new File(['svg'], 'x.svg', { type: 'image/svg+xml' })))).status,
    ).toBe(400)
    expect(
      (
        await POST(
          imageRequest(
            {},
            new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'x.jpg', { type: 'image/jpeg' }),
          ),
        )
      ).status,
    ).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('accepts already-deleted tickets on retry', async () => {
    mocks.fetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect((await DELETE(deletionRequest())).status).toBe(204)
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })
  it('keeps deletion failures and revision conflicts visible', async () => {
    mocks.fetch
      .mockResolvedValueOnce(ticketResponse())
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
    expect((await DELETE(deletionRequest())).status).toBe(409)
    mocks.fetch.mockRejectedValueOnce(new Error('timeout'))
    expect((await DELETE(deletionRequest())).status).toBe(502)
  })
  it('requires authentication, same origin and page access before deleting', async () => {
    expect((await DELETE(request(input, 'https://elsewhere.test'))).status).toBe(403)
    mocks.auth.mockResolvedValueOnce({ user: null })
    expect((await DELETE(deletionRequest())).status).toBe(403)
    mocks.findByID.mockRejectedValueOnce(new Error('forbidden'))
    expect((await DELETE(deletionRequest())).status).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('tests saved credentials without disclosing them', async () => {
    mocks.read.mockResolvedValue({ encryptedApiKey: 'encrypted' })
    mocks.decrypt.mockReturnValue('private-test-key')
    mocks.options.mockResolvedValue({ projects: [{ id: 'p', name: 'Tickets' }], labels: [] })
    const req = await payloadRequest(request({ apiKey: '' }))
    const response = await createAnnotationConnectionHandler()(req)
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('private-test-key')
    expect(mocks.options).toHaveBeenCalledWith('private-test-key')
  })
  it('respects host settings access and excludes API-key accounts', async () => {
    expect(
      await createAnnotationConnectionHandler(() => false)(
        await payloadRequest(request({ apiKey: 'key' })),
      ),
    ).toHaveProperty('status', 403)
    mocks.auth.mockResolvedValueOnce({ user: { collection: 'api-keys' } })
    expect(
      await createAnnotationConnectionHandler()(await payloadRequest(request({ apiKey: 'key' }))),
    ).toHaveProperty('status', 403)
    expect(mocks.options).not.toHaveBeenCalled()
  })
  it('uses a different host collection and admin collection without REC assumptions', async () => {
    const req = await payloadRequest(
      request({ ...input, document: { ...input.document, collection: 'articles' } }),
    )
    req.payload.config.admin.user = 'editors'
    req.user = { id: 'editor', collection: 'editors' } as PayloadRequest['user']
    expect((await createAnnotationHandler({ articles: true }, 'submit')(req)).status).toBe(200)
    expect(mocks.findByID).toHaveBeenCalledWith(expect.objectContaining({ collection: 'articles' }))
  })
})
