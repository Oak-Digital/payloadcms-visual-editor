import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import type { GlobalSlug, Payload } from 'payload'
export type AnnotationSettings = {
  enabled?: boolean
  encryptedApiKey?: string | null
  projectId?: string | null
  bugLabelId?: string | null
  apiKeyConfigured?: boolean
}

function encryptionKey(secret: string) {
  if (!secret) throw new Error('Payload secret is required.')
  return createHash('sha256').update(`visual-editor:oak-os:${secret}`).digest()
}
export function encryptApiKey(value: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}
export function decryptApiKey(value: string, secret: string): string {
  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('Invalid saved credential.')
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !encrypted) throw new Error('Invalid saved credential.')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

/** Trusted server reads only, after authenticating the caller. Never return this record to a client. */
export async function readAnnotationSettings(payload: Payload) {
  return (await payload.findGlobal({
    slug: 'visual-editor-settings' as GlobalSlug,
    depth: 0,
    overrideAccess: true,
  })) as AnnotationSettings
}
export async function getAnnotationIntegration(payload: Payload) {
  const settings = await readAnnotationSettings(payload)
  if (!settings.enabled || !settings.encryptedApiKey || !settings.projectId || !settings.bugLabelId)
    return null
  try {
    return {
      key: decryptApiKey(settings.encryptedApiKey, payload.secret),
      projectId: settings.projectId,
      bugLabelId: settings.bugLabelId,
    }
  } catch {
    return null
  }
}

export async function getOakConnectionOptions(key: string) {
  const read = async (path: string) => {
    const response = await fetch(`https://os.oak.dk/api/v1/${path}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    })
    if (!response.ok)
      throw new Error('Connection failed. Check the API key and its project permissions.')
    return response.json()
  }
  const projects: Array<{ id: string; name: string }> = []
  const [meta, firstPage] = await Promise.all([read('meta'), read('projects?limit=100')])
  let page = firstPage
  const seen = new Set<string>()
  for (;;) {
    if (!Array.isArray(page.data)) throw new Error('Oak OS returned invalid projects.')
    for (const project of page.data) {
      if (typeof project.id === 'string' && typeof project.name === 'string')
        projects.push({ id: project.id, name: project.name })
    }
    const cursor = page.pagination?.nextCursor
    if (!cursor) break
    if (typeof cursor !== 'string' || seen.has(cursor))
      throw new Error('Unable to load Oak OS projects.')
    seen.add(cursor)
    page = await read(`projects?limit=100&cursor=${encodeURIComponent(cursor)}`)
  }
  if (!Array.isArray(meta.data?.labels)) throw new Error('Oak OS returned invalid labels.')
  const labels: Array<{ id: string; name: string }> = meta.data.labels
    .filter(
      (label: { id?: unknown; name?: unknown }) =>
        typeof label.id === 'string' && typeof label.name === 'string',
    )
    .map((label: { id: string; name: string }) => ({ id: label.id, name: label.name }))
  return { projects, labels }
}
