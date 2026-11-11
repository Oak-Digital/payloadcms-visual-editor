import type { Payload } from 'payload'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decryptApiKey,
  encryptApiKey,
  getAnnotationIntegration,
  getOakConnectionOptions,
} from './settings.js'

afterEach(() => vi.unstubAllGlobals())
describe('annotation integration settings', () => {
  it('encrypts credentials with unique nonces and rejects tampering or a different secret', () => {
    const encrypted = encryptApiKey('private-test-key', 'payload-secret')
    expect(encrypted).not.toContain('private-test-key')
    expect(encryptApiKey('private-test-key', 'payload-secret')).not.toBe(encrypted)
    expect(decryptApiKey(encrypted, 'payload-secret')).toBe('private-test-key')
    expect(() => decryptApiKey(encrypted, 'other-secret')).toThrow()
    expect(() => decryptApiKey(`a${encrypted.slice(1)}`, 'payload-secret')).toThrow()
  })
  it('loads only complete, enabled configuration and fails closed for unreadable keys', async () => {
    const findGlobal = vi.fn()
    const payload = { findGlobal, secret: 'secret' } as unknown as Payload
    const settings = {
      enabled: true,
      encryptedApiKey: encryptApiKey('test-key', 'secret'),
      projectId: 'project',
      bugLabelId: 'bug',
    }
    findGlobal.mockResolvedValue(settings)
    expect(await getAnnotationIntegration(payload)).toEqual({
      key: 'test-key',
      projectId: 'project',
      bugLabelId: 'bug',
    })
    findGlobal.mockResolvedValue({ ...settings, enabled: false })
    expect(await getAnnotationIntegration(payload)).toBeNull()
    findGlobal.mockResolvedValue({ ...settings, encryptedApiKey: 'broken' })
    expect(await getAnnotationIntegration(payload)).toBeNull()
  })
  it('loads paginated projects and returns only selection data', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/meta'))
        return Response.json({ data: { labels: [{ id: 'bug', name: 'Bug', private: 'omit' }] } })
      if (url.includes('cursor='))
        return Response.json({ data: [{ id: 'two', name: 'Second' }], pagination: {} })
      return Response.json({
        data: [{ id: 'one', name: 'First', private: 'omit' }],
        pagination: { nextCursor: 'next' },
      })
    })
    vi.stubGlobal('fetch', fetcher)
    expect(await getOakConnectionOptions('test-key')).toEqual({
      projects: [
        { id: 'one', name: 'First' },
        { id: 'two', name: 'Second' },
      ],
      labels: [{ id: 'bug', name: 'Bug' }],
    })
  })
})
