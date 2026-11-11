/** Presentation only: keep the original element description in exported feedback. */
export function annotationLabel(element: string): string {
  const description = element
    .replace(/<[^>]*>/g, '')
    .trim()
    .toLowerCase()
  const labels: Array<[RegExp, string]> = [
    [/^(h[1-6]|heading)\b/, 'Heading'],
    [/^(image|img|picture)\b/, 'Image'],
    [/^(link|a)\b/, 'Link'],
    [/^button\b/, 'Button'],
    [/^(paragraph|text|span|p)\b|^["“]/, 'Text'],
    [/^(input|textarea|select|checkbox|radio)\b/, 'Form field'],
    [/^(video|audio)\b/, 'Media'],
    [/^(list|li|ul|ol)\b/, 'List'],
    [/^(section|container|div|main|header|footer|nav)\b/, 'Section'],
  ]
  return labels.find(([pattern]) => pattern.test(description))?.[1] ?? 'Page element'
}
