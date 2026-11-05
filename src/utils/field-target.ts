import type { PayloadCMSDocument } from '../types.js'

export function documentKey(document: PayloadCMSDocument | null) {
  return document ? JSON.stringify([document.collection, document.id, document.locale]) : 'null'
}

export function fieldDocument(
  element: Element,
  fallback: PayloadCMSDocument,
): PayloadCMSDocument | null {
  const encoded = element.closest('[data-payload-document]')?.getAttribute('data-payload-document')
  if (!encoded) return fallback
  try {
    const value = JSON.parse(encoded)
    if (
      value &&
      typeof value.collection === 'string' &&
      (typeof value.id === 'string' || typeof value.id === 'number') &&
      (value.locale === undefined || typeof value.locale === 'string')
    )
      return { ...value, hasDrafts: true }
  } catch {
    /* Invalid host metadata is not an editable target. */
  }
  return null
}
