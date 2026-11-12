import type { PayloadRequest } from 'payload'

export type Availability = { label: string; public: boolean; url?: string }
export type PageSettingsConfig = Record<
  string,
  {
    /** Explicit field roots offered in Page settings. */
    fields: string[]
    sections?: { label: string; fields: string[] }[]
    previewURL?: (document: Record<string, any>, locale: string) => string
    hasContent?: (document: Record<string, any>) => boolean
    searchPreview?: (
      document: Record<string, any>,
      locale: string | undefined,
      req: PayloadRequest,
    ) =>
      | { title: string; description: string; url: string }
      | Promise<{ title: string; description: string; url: string }>
    /** Host policy; evaluating this callback must never write content. */
    availability?: (args: {
      document: Record<string, any>
      locale?: string
      published: boolean
      req: PayloadRequest
    }) => Availability | Promise<Availability>
  }
>
