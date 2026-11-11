import { createAnnotationSettings, type AnnotationSettingsAccess } from './annotations/config.js'
import {
  createAnnotationHandler,
  createAnnotationConnectionHandler,
} from './annotations/handlers.js'
import type { CollectionAfterReadHook, CollectionSlug, Config, Field, FieldHook } from 'payload'

import { createVisualEditorMutationHandler } from './endpoints/visualEditorMutationHandler.js'
import { createMediaHandler } from './endpoints/mediaHandler.js'
import { createRevisionHandler } from './endpoints/revisionHandler.js'
import { createArrangeHandler } from './endpoints/arrangeHandler.js'
import { createRichTextHandler } from './endpoints/richTextHandler.js'
import { createSharedContentHandler } from './endpoints/sharedContentHandler.js'
import type { SharedContentConfig } from './utils/shared-content.js'
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
  sharedContent?: SharedContentConfig
  /** Register reusable Oak OS annotation settings and endpoints. */
  annotations?: boolean | { settingsAccess?: AnnotationSettingsAccess }
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

    if (pluginOptions.annotations) {
      const settingsAccess =
        typeof pluginOptions.annotations === 'object'
          ? pluginOptions.annotations.settingsAccess
          : undefined
      if (config.globals?.some((global) => global.slug === 'visual-editor-settings'))
        throw new Error('The visual-editor-settings Global is owned by the visual editor plugin.')
      config.globals = [...(config.globals ?? []), createAnnotationSettings(settingsAccess)]
      config.endpoints.push(
        {
          path: '/payload-visual-editor/annotations',
          method: 'post',
          handler: createAnnotationHandler(pluginOptions.collections ?? {}, 'submit'),
        },
        {
          path: '/payload-visual-editor/annotations',
          method: 'delete',
          handler: createAnnotationHandler(pluginOptions.collections ?? {}, 'delete'),
        },
        {
          path: '/payload-visual-editor/connection',
          method: 'post',
          handler: createAnnotationConnectionHandler(settingsAccess),
        },
      )
    }

    config.admin ??= {}
    config.admin.components ??= {}
    config.admin.components.views ??= {}
    config.admin.components.views.visualRichText = {
      Component: '@oak-digital/payload-visual-editor/client#RichTextEditorView',
      path: '/visual-rich-text',
    }
    config.endpoints.push({
      handler: createSharedContentHandler(pluginOptions.sharedContent ?? {}),
      method: 'post',
      path: '/payload-visual-editor/shared-content',
    })

    config.endpoints.push({
      handler: createRevisionHandler(pluginOptions.collections ?? {}),
      method: 'post',
      path: '/payload-visual-editor/revisions',
    })

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
