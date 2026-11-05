import type { CollectionAfterReadHook, CollectionSlug, Config, Field, FieldHook } from 'payload'

import { createVisualEditorMutationHandler } from './endpoints/visualEditorMutationHandler.js'
import { createMediaHandler } from './endpoints/mediaHandler.js'
import { createArrangeHandler } from './endpoints/arrangeHandler.js'
import { createRichTextHandler } from './endpoints/richTextHandler.js'
import { buildSourceMap } from './utils/source-map.js'

const populateSourceMap =
  (fields: Field[]): FieldHook =>
  ({ data, context }) => {
    if (!data || context.contentSourceMap !== true) {
      return
    }
    return buildSourceMap(fields, data)
  }

const sourceMapContextHandler: CollectionAfterReadHook = ({ context, doc }) => {
  if (context.contentSourceMap !== true) {
    return { ...doc, _sourceMap: undefined }
  }
}

export type PayloadVisualEditorConfig = {
  /**
   * List of collections to add a custom field
   */
  collections?: Partial<Record<CollectionSlug, true>>
  disabled?: boolean
}

const payloadVisualEditor =
  (pluginOptions: PayloadVisualEditorConfig) =>
  (config: Config): Config => {
    config = {
      ...config,
      collections: config.collections?.map((collection) => ({
        ...collection,
        fields: [...collection.fields],
        hooks: { ...collection.hooks, afterRead: [...(collection.hooks?.afterRead ?? [])] },
      })),
      endpoints: [...(config.endpoints ?? [])],
      admin: {
        ...config.admin,
        components: { ...config.admin?.components, views: { ...config.admin?.components?.views } },
      },
    }
    if (!config.collections) {
      config.collections = []
    }

    if (pluginOptions.collections) {
      for (const collectionSlug in pluginOptions.collections) {
        const collection = config.collections.find(
          (collection) => collection.slug === collectionSlug,
        )

        if (collection) {
          const sourceMapFields = [...collection.fields]

          collection.fields.push({
            name: '_sourceMap',
            type: 'json',
            admin: {
              disabled: true,
              hidden: true,
              position: 'sidebar',
            },
            hooks: {
              afterRead: [populateSourceMap(sourceMapFields)],
            },
            virtual: true,
          })

          collection.hooks ??= {}
          collection.hooks.afterRead ??= []
          collection.hooks.afterRead.push(sourceMapContextHandler)
        }
      }
    }

    /**
     * If the plugin is disabled, we still want to keep added collections/fields so the database schema is consistent which is important for migrations.
     * If your plugin heavily modifies the database schema, you may want to remove this property.
     */
    if (pluginOptions.disabled) {
      return config
    }

    if (!config.endpoints) {
      config.endpoints = []
    }

    config.admin ??= {}
    config.admin.components ??= {}
    config.admin.components.views ??= {}
    config.admin.components.views.visualRichText = {
      Component: '@oak-digital/payload-visual-editor/client#RichTextEditorView',
      path: '/visual-rich-text',
    }
    config.endpoints.push({
      handler: createArrangeHandler(pluginOptions.collections ?? {}),
      method: 'post',
      path: '/payload-visual-editor/arrange',
    })

    config.endpoints.push({
      handler: createRichTextHandler(pluginOptions.collections ?? {}),
      method: 'post',
      path: '/payload-visual-editor/rich-text',
    })

    config.endpoints.push({
      handler: createMediaHandler(pluginOptions.collections ?? {}),
      method: 'post',
      path: '/payload-visual-editor/media',
    })

    config.endpoints.push({
      handler: createVisualEditorMutationHandler(pluginOptions.collections ?? {}),
      method: 'post',
      path: '/payload-visual-editor',
    })

    return config
  }

export { payloadVisualEditor }
export { createEditableAttrs } from './utilities.js'
export { buildSourceMap } from './utils/source-map.js'
