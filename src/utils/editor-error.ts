export type FieldIssue = {
  label: string
  message: string
  path: string
}

export class EditorRequestError extends Error {
  fieldErrors: FieldIssue[]

  constructor(message: string, fieldErrors: FieldIssue[] = []) {
    super(message)
    this.fieldErrors = fieldErrors
  }
}
