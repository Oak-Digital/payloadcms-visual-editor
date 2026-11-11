import type { Config, PayloadRequest, SanitizedGlobalConfig } from 'payload'
import { expect, it } from 'vitest'
import { payloadVisualEditor } from '../index.js'
import { createAnnotationSettings } from './config.js'
import { decryptApiKey, encryptApiKey } from './settings.js'

it('registers reusable settings and endpoints without mutating the host configuration', () => {
  const host: Config = {
    db: {} as Config['db'],
    secret: 'test-secret',
    collections: [{ slug: 'articles', fields: [] }],
    globals: [{ slug: 'branding', fields: [] }],
    admin: { user: 'editors' },
  }
  const result = payloadVisualEditor({ collections: { articles: true }, annotations: true })(host)
  expect(result.globals?.map((item) => item.slug)).toEqual(['branding', 'visual-editor-settings'])
  expect(
    result.endpoints?.filter(
      (item) => item.path.includes('annotations') || item.path.includes('connection'),
    ),
  ).toHaveLength(3)
  expect(host.globals?.map((item) => item.slug)).toEqual(['branding'])
  expect(payloadVisualEditor({ annotations: false })(host).globals).toEqual(host.globals)
})

it('preserves, replaces and removes keys without trusting client-supplied ciphertext', async () => {
  const global = createAnnotationSettings()
  const hook = global.hooks!.beforeChange![0]!
  const req = { payload: { secret: 'test-secret' } } as PayloadRequest
  const encrypted = encryptApiKey('original-key', 'test-secret')
  const originalDoc = { enabled: false, encryptedApiKey: encrypted }
  const run = (data: Record<string, unknown>) =>
    hook({ data, originalDoc, req, global: global as SanitizedGlobalConfig, context: {} })
  expect((await run({ apiKeyInput: '', encryptedApiKey: 'forged' })).encryptedApiKey).toBe(
    encrypted,
  )
  const replaced = await run({ apiKeyInput: 'new-key' })
  expect(decryptApiKey(replaced.encryptedApiKey, 'test-secret')).toBe('new-key')
  expect(replaced.apiKeyInput).toBe('')
  expect(replaced.apiKeyConfigured).toBe(true)
  expect((await run({ clearApiKey: true })).encryptedApiKey).toBeNull()
  await expect(run({ enabled: true, clearApiKey: true })).rejects.toThrow('Add an API key')
})
