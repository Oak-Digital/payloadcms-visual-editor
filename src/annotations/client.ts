import type { DeleteAnnotationTicket, SubmitAnnotation } from '../types.js'

export function annotationTicketClient(apiRoute: string): {
  submit: SubmitAnnotation
  delete: DeleteAnnotationTicket
} {
  const url = `${apiRoute}/payload-visual-editor/annotations`
  return {
    submit: async (annotation) => {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(annotation),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Unable to send feedback. Try again.')
      return result
    },
    delete: async (annotation, ticket) => {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...annotation, identifier: ticket.identifier }),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Unable to delete ticket. Try again.')
      }
    },
  }
}
