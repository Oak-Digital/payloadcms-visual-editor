import { screenshotStore } from './screenshot.js'

import type { DeleteAnnotationTicket, SubmitAnnotation } from '../types.js'

export function annotationTicketClient(apiRoute: string): {
  submit: SubmitAnnotation
  delete: DeleteAnnotationTicket
} {
  const url = `${apiRoute}/payload-visual-editor/annotations`
  return {
    submit: async (annotation, ticket) => {
      let body: BodyInit = JSON.stringify(annotation)
      if (annotation.screenshot) {
        const screenshot = await screenshotStore(annotation.id)
        if (!screenshot)
          throw new Error(
            'The original screenshot is missing. Check the Oak OS ticket before creating a new note.',
          )
        const form = new FormData()
        form.set('annotation', JSON.stringify({ ...annotation, identifier: ticket?.identifier }))
        form.set('screenshot', screenshot, 'screenshot.jpg')
        body = form
      }
      const response = await fetch(url, {
        method: 'POST',
        headers: annotation.screenshot ? undefined : { 'Content-Type': 'application/json' },
        body,
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
      await screenshotStore(annotation.id, null).catch(() => undefined)
    },
  }
}
