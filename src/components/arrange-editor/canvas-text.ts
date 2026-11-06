/** Plain-text canvas editing shares the sidebar's staged values, never a second save path. */
export type CanvasTextField = {
  key: string
  path: string
  label: string
  multiline: boolean
  value: string
  changed: boolean
}
type Options = {
  enabled: boolean
  blocked: boolean
  refreshing: boolean
  resolve: (element: HTMLElement) => CanvasTextField | undefined
  onSelect: (field: CanvasTextField) => void
  onChange: (field: CanvasTextField, value: string) => void
  onUndo: () => void
  onRedo: () => void
}

function capture(node: Node): () => void {
  const children = [...node.childNodes]
  const restoreChildren = children.map(capture)
  const text = node.nodeValue
  return () => {
    if (node.nodeValue !== text) node.nodeValue = text
    if (
      children.length !== node.childNodes.length ||
      children.some((child, i) => node.childNodes[i] !== child)
    ) {
      while (node.firstChild) node.removeChild(node.firstChild)
      children.forEach((child) => node.appendChild(child))
    }
    restoreChildren.forEach((restore) => restore())
  }
}

function readText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || ''
  if (node.nodeName === 'BR')
    return (node as Element).hasAttribute('data-arrange-placeholder') ? '' : '\n'
  return [...node.childNodes]
    .map((child, index) => {
      const prefix = index && ['DIV', 'P'].includes(child.nodeName) ? '\n' : ''
      return prefix + readText(child)
    })
    .join('')
    .replace(/\u00a0/g, ' ')
}

function caret(element: HTMLElement) {
  if (element.ownerDocument.activeElement !== element) return
  const selection = element.ownerDocument.getSelection()
  if (
    !selection?.rangeCount ||
    !element.contains(selection.anchorNode) ||
    !element.contains(selection.focusNode)
  )
    return
  const range = selection.getRangeAt(0)
  const prefix = range.cloneRange()
  prefix.selectNodeContents(element)
  prefix.setEnd(range.startContainer, range.startOffset)
  return {
    start: readText(prefix.cloneContents()).length,
    end: readText(prefix.cloneContents()).length + readText(range.cloneContents()).length,
  }
}

function restoreCaret(element: HTMLElement, offsets: ReturnType<typeof caret>) {
  if (!offsets) return
  const doc = element.ownerDocument
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  const nodes: Node[] = []
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node.nodeType === Node.TEXT_NODE || node.nodeName === 'BR') nodes.push(node)
  }
  const point = (offset: number): [Node, number] => {
    for (const node of nodes) {
      const length =
        node.nodeType === Node.TEXT_NODE ? (node as Text).length : readText(node).length
      if (offset <= length) {
        if (node.nodeType === Node.TEXT_NODE) return [node, offset]
        return [
          node.parentNode!,
          [...node.parentNode!.childNodes].indexOf(node as ChildNode) + (offset ? 1 : 0),
        ]
      }
      offset -= length
    }
    return [element, element.childNodes.length]
  }
  const range = doc.createRange()
  range.setStart(...point(offsets.start))
  range.setEnd(...point(offsets.end))
  const selection = doc.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function createCanvasTextEditor(doc: Document) {
  let options: Options
  let composing: HTMLElement | undefined
  const records = new Map<
    HTMLElement,
    { restore: () => void; attributes: Map<string, string | null> }
  >()
  const attributes = [
    'contenteditable',
    'data-arrange-inline',
    'aria-multiline',
    'aria-label',
    'role',
  ]
  const restoreAttributes = (element: HTMLElement, values: Map<string, string | null>) => {
    for (const [name, value] of values) {
      if (value === null) element.removeAttribute(name)
      else element.setAttribute(name, value)
    }
  }
  const target = (event: Event) => {
    const node =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-arrange-inline]')
        : null
    return node && options.enabled && !options.blocked ? node : undefined
  }
  const change = (element: HTMLElement) => {
    const field = options.resolve(element)
    if (field) options.onChange(field, readText(element))
  }
  const focus = (event: Event) => {
    const element = target(event)
    const field = element && options.resolve(element)
    if (field && element) {
      // Animated headings can contain duplicated/decorative glyphs. Edit the stored text,
      // while keeping the original React nodes available for blur and preview refresh.
      if (readText(element) !== field.value)
        element.replaceChildren(doc.createTextNode(field.value))
      options.onSelect(field)
    }
  }
  const blur = (event: Event) => {
    const element = event.target instanceof HTMLElement ? event.target : undefined
    if (element && !options.resolve(element)?.changed) records.get(element)?.restore()
  }
  const input = (event: Event) => {
    const element = target(event)
    if (element && composing !== element) change(element)
  }
  const insert = (element: HTMLElement, text: string) => {
    const selection = doc.getSelection()
    if (
      !selection?.rangeCount ||
      !element.contains(selection.anchorNode) ||
      !element.contains(selection.focusNode)
    )
      return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    const fragment = doc.createDocumentFragment()
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      if (line) fragment.append(doc.createTextNode(line))
      if (index < lines.length - 1) fragment.append(doc.createElement('br'))
    })
    const last = fragment.lastChild
    if (!last) return
    range.insertNode(fragment)
    // Browsers need a trailing placeholder to place the caret on a new final line.
    if (
      last.nodeName === 'BR' &&
      (!last.nextSibling ||
        (last.nextSibling.nodeType === Node.TEXT_NODE && !last.nextSibling.nodeValue))
    ) {
      const placeholder = doc.createElement('br')
      placeholder.setAttribute('data-arrange-placeholder', '')
      last.parentNode!.appendChild(placeholder)
    }
    range.setStartAfter(last)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
    change(element)
  }
  const beforeInput = (event: InputEvent) => {
    const element = target(event)
    if (!element) return
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      event.preventDefault()
      if (options.resolve(element)?.multiline) insert(element, '\n')
    }
  }
  const paste = (event: ClipboardEvent) => {
    const element = target(event)
    if (!element) return
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') || ''
    insert(element, options.resolve(element)?.multiline ? text : text.replace(/[\r\n]+/g, ' '))
  }
  const drop = (event: DragEvent) => {
    if (target(event)) event.preventDefault()
  }
  const compositionStart = (event: CompositionEvent) => {
    composing = target(event)
  }
  const compositionEnd = (event: CompositionEvent) => {
    const element = target(event)
    composing = undefined
    if (element) change(element)
  }
  const keyboard = (event: KeyboardEvent) => {
    const element = target(event)
    if (!element || event.isComposing) return
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      ['z', 'y'].includes(event.key.toLowerCase())
    ) {
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.shiftKey || event.key.toLowerCase() === 'y') options.onRedo()
      else options.onUndo()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      element.blur()
    }
  }
  doc.addEventListener('focusin', focus, true)
  doc.addEventListener('focusout', blur, true)
  doc.addEventListener('input', input, true)
  doc.addEventListener('beforeinput', beforeInput, true)
  doc.addEventListener('paste', paste, true)
  doc.addEventListener('drop', drop, true)
  doc.addEventListener('compositionstart', compositionStart, true)
  doc.addEventListener('compositionend', compositionEnd, true)
  doc.addEventListener('keydown', keyboard, true)
  const restoreAll = () => {
    for (const [element, record] of records) {
      record.restore()
      restoreAttributes(element, record.attributes)
    }
    records.clear()
    composing = undefined
  }
  return {
    update(next: Options) {
      options = next
      if (next.refreshing) {
        restoreAll()
        return
      }
      for (const element of doc.querySelectorAll<HTMLElement>('[data-payload-path]')) {
        const field = next.resolve(element)
        if (!field) continue
        let record = records.get(element)
        if (!record) {
          record = {
            restore: capture(element),
            attributes: new Map(attributes.map((name) => [name, element.getAttribute(name)])),
          }
          records.set(element, record)
        }
        if (next.enabled && !next.blocked) {
          element.setAttribute('contenteditable', 'plaintext-only')
          element.setAttribute('data-arrange-inline', '')
          element.setAttribute('role', 'textbox')
          element.setAttribute('aria-label', field.label)
          element.setAttribute('aria-multiline', String(field.multiline))
        } else restoreAttributes(element, record.attributes)
        if (composing === element) continue
        const selection = caret(element)
        let mutated = false
        if (!field.changed && doc.activeElement !== element) record.restore()
        else if (!field.changed && readText(element) !== field.value) {
          mutated = true
          element.replaceChildren(doc.createTextNode(field.value))
        } else if (readText(element) !== field.value) {
          mutated = true
          record.restore()
          const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT)
          let first = true
          while (walker.nextNode()) {
            ;(walker.currentNode as Text).data = first ? field.value : ''
            first = false
          }
          if (first) element.append(doc.createTextNode(field.value))
        }
        if (mutated) restoreCaret(element, selection)
      }
      for (const [element, record] of records) {
        if (!element.isConnected || !next.resolve(element)) {
          record.restore()
          restoreAttributes(element, record.attributes)
          records.delete(element)
        }
      }
    },
    destroy() {
      restoreAll()
      doc.removeEventListener('focusin', focus, true)
      doc.removeEventListener('focusout', blur, true)
      doc.removeEventListener('input', input, true)
      doc.removeEventListener('beforeinput', beforeInput, true)
      doc.removeEventListener('paste', paste, true)
      doc.removeEventListener('drop', drop, true)
      doc.removeEventListener('compositionstart', compositionStart, true)
      doc.removeEventListener('compositionend', compositionEnd, true)
      doc.removeEventListener('keydown', keyboard, true)
    },
  }
}
