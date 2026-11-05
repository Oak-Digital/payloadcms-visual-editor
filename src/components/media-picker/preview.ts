import { documentKey, fieldDocument } from '../../utils/field-target.js'
import type { Annotation, PayloadCMSDocument } from '../../types.js'

/** Restore every responsive source on cleanup, including Next Image's generated srcset. */
export function previewImages(
  annotations: Annotation[],
  root: ParentNode = document,
  fallback?: PayloadCMSDocument,
) {
  const restore: (() => void)[] = []
  for (const annotation of annotations) {
    if (!annotation.media) continue
    const { path } = annotation.payloadCMS
    for (const marker of root.querySelectorAll<HTMLElement>('[data-payload-type="upload"]')) {
      if (marker.dataset.payloadPath !== path) continue
      const owner = annotation.payloadCMS.document ?? fallback
      if (owner && documentKey(fieldDocument(marker, fallback ?? owner)) !== documentKey(owner))
        continue
      const image =
        marker instanceof HTMLImageElement || marker instanceof HTMLSourceElement
          ? marker
          : marker.querySelector('img')
      if (!image) continue
      const attrs = ['src', 'srcset', 'sizes', 'alt']
      const original = attrs.map((name) => [name, image.getAttribute(name)] as const)
      restore.push(() =>
        original.forEach(([name, value]) =>
          value === null ? image.removeAttribute(name) : image.setAttribute(name, value),
        ),
      )
      const picture = image.closest('picture')
      const styled = picture || image
      const style = styled.getAttribute('style')
      restore.push(() =>
        style === null ? styled.removeAttribute('style') : styled.setAttribute('style', style),
      )
      const position = `${annotation.media.focalX ?? 50}% ${annotation.media.focalY ?? 50}%`
      if (picture)
        picture.style.setProperty(
          image instanceof HTMLSourceElement ? '--mobile-position' : '--desktop-position',
          position,
        )
      else image.style.objectPosition = position
      image.removeAttribute('srcset')
      image.removeAttribute('sizes')
      if (image instanceof HTMLSourceElement) image.srcset = annotation.media.url
      else image.src = annotation.media.url
      // Alt is owned by the media item; do not overwrite intentionally decorative host alt text.
      if (image instanceof HTMLImageElement && image.alt) image.alt = annotation.media.alt || ''
    }
  }
  return () => restore.reverse().forEach((fn) => fn())
}

export function imageFieldAt(
  target: HTMLElement,
): { path: string; element: HTMLElement } | undefined {
  const marker = target.closest<HTMLElement>('[data-payload-type="upload"]')
  if (!marker?.dataset.payloadPath) return
  const picture = marker.closest('picture')
  const activeSource =
    picture &&
    Array.from(picture.querySelectorAll<HTMLSourceElement>('source[data-payload-path]')).find(
      (source) => !source.media || window.matchMedia(source.media).matches,
    )
  const mobilePath = marker.dataset.payloadMobilePath
  return {
    path:
      activeSource?.dataset.payloadPath ||
      (mobilePath && window.matchMedia('(max-width: 767px)').matches
        ? mobilePath
        : marker.dataset.payloadPath),
    element: marker,
  }
}
