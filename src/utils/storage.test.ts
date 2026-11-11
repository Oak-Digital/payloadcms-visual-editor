// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { loadAnnotations, saveAnnotations } from './storage.js'

afterEach(() => localStorage.clear())
it('retains ticket requests and links beyond ordinary note retention', () => {
  const timestamp = Date.now() - 8 * 24 * 60 * 60 * 1000
  const notes = [
    { id: 'ordinary', timestamp },
    { id: 'failed', timestamp, ticketRequest: { id: 'request' }, ticketError: 'Offline' },
    { id: 'sent', timestamp, ticketRequest: { id: 'request2' }, ticket: { identifier: 'REC-1' } },
  ]
  saveAnnotations('/en/page', notes)
  expect(loadAnnotations('/en/page')).toEqual(notes.slice(1))
  expect(loadAnnotations('/en/other')).toEqual([])
})
