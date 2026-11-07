import type { PayloadRequest, ValidationFieldError } from 'payload'

import type { FieldIssue } from './editor-error.js'

export function validationErrors(error: unknown, req: PayloadRequest): FieldIssue[] {
  if (!(error instanceof Error) || error.name !== 'ValidationError' || !('data' in error)) {
    return []
  }
  const data = error.data as { errors?: ValidationFieldError[] } | undefined
  if (!Array.isArray(data?.errors)) {
    return []
  }
  return data.errors.map(({ label, message, path }) => ({
    label:
      typeof label === 'function'
        ? label({ i18n: req.i18n, t: req.t })
        : typeof label === 'object' && label
          ? label[req.i18n?.language] || path
          : label || path,
    message,
    path,
  }))
}
