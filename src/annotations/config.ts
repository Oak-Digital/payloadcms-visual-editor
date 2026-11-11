import { APIError, type GlobalConfig, type PayloadRequest } from 'payload'
import { decryptApiKey, encryptApiKey, getOakConnectionOptions } from './settings.js'

export type AnnotationSettingsAccess = (args: { req: PayloadRequest }) => boolean | Promise<boolean>
export const defaultSettingsAccess: AnnotationSettingsAccess = ({ req }) =>
  Boolean(req.user && req.user.collection === req.payload.config.admin.user)
export function createAnnotationSettings(
  settingsAccess: AnnotationSettingsAccess = defaultSettingsAccess,
): GlobalConfig {
  return {
    slug: 'visual-editor-settings',
    label: 'Visual Editor',
    admin: { group: 'Tools & Settings' },
    access: {
      read: settingsAccess,
      update: settingsAccess,
    },
    fields: [
      {
        name: 'enabled',
        label: 'Enable annotation tickets',
        type: 'checkbox',
        defaultValue: false,
      },
      {
        name: 'connection',
        type: 'ui',
        admin: {
          components: {
            Field: '@oak-digital/payload-visual-editor/client#AnnotationSettingsField',
          },
        },
      },
      {
        name: 'apiKeyInput',
        type: 'text',
        admin: { hidden: true },
        hooks: { afterRead: [() => ''] },
      },
      {
        name: 'clearApiKey',
        type: 'checkbox',
        admin: { hidden: true },
        hooks: { afterRead: [() => false] },
      },
      { name: 'apiKeyConfigured', type: 'checkbox', admin: { hidden: true, readOnly: true } },
      {
        name: 'encryptedApiKey',
        type: 'text',
        admin: { hidden: true },
        access: { read: () => false, update: () => false },
      },
      { name: 'projectId', type: 'text', admin: { hidden: true } },
      { name: 'bugLabelId', type: 'text', admin: { hidden: true } },
    ],
    hooks: {
      beforeChange: [
        async ({ data, originalDoc, req }) => {
          const keyInput = typeof data.apiKeyInput === 'string' ? data.apiKeyInput.trim() : ''
          if (keyInput.length > 500) throw new APIError('API key is too long.', 400)
          const encrypted = data.clearApiKey
            ? null
            : keyInput
              ? encryptApiKey(keyInput, req.payload.secret)
              : originalDoc?.encryptedApiKey || null
          data.encryptedApiKey = encrypted
          data.apiKeyConfigured = Boolean(encrypted)
          data.apiKeyInput = ''
          data.clearApiKey = false
          const enabled = data.enabled ?? originalDoc?.enabled
          const projectId = data.projectId ?? originalDoc?.projectId
          const bugLabelId = data.bugLabelId ?? originalDoc?.bugLabelId
          if (enabled) {
            if (!encrypted || !projectId || !bugLabelId)
              throw new APIError(
                'Add an API key, project and Bug label before enabling tickets.',
                400,
              )
            const changed =
              keyInput ||
              !originalDoc?.enabled ||
              projectId !== originalDoc?.projectId ||
              bugLabelId !== originalDoc?.bugLabelId
            if (changed) {
              let options: Awaited<ReturnType<typeof getOakConnectionOptions>>
              try {
                options = await getOakConnectionOptions(
                  decryptApiKey(encrypted, req.payload.secret),
                )
              } catch {
                throw new APIError(
                  'Unable to validate the Oak OS connection. Check the key and try again.',
                  400,
                )
              }
              if (
                !options.projects.some((item) => item.id === projectId) ||
                !options.labels.some((item) => item.id === bugLabelId)
              ) {
                throw new APIError('Select a project and label available to this API key.', 400)
              }
            }
          }
          return data
        },
      ],
    },
  }
}
