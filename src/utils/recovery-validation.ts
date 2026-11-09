import { safePath } from './arrange.js'

type RecordValue = Record<string, any>
const record = (value: unknown): value is RecordValue =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const dictionary = (value: unknown, valid: (item: any) => boolean): boolean =>
  record(value) && Object.entries(value).every(([key, item]) => safePath(key) && valid(item))
const list = (value: unknown, valid: (item: any) => boolean): boolean =>
  Array.isArray(value) && value.every(valid)
const row = (value: unknown): boolean => record(value) && text(value.id) && text(value.label)
const layout = (value: unknown): boolean =>
  list(
    value,
    (node) =>
      record(node) &&
      safePath(node.path) &&
      text(node.label) &&
      text(node.type) &&
      (node.children === undefined || layout(node.children)) &&
      (node.collapsed === undefined || typeof node.collapsed === 'boolean'),
  )
const field = (value: unknown): boolean => {
  if (!record(value)) return false
  if (value.type === 'relationship')
    return text(value.collection) && safePath(value.layoutPath) && list(value.choices, row)
  if (
    ['text', 'textarea', 'upload', 'richText', 'checkbox', 'number', 'email'].includes(value.type)
  )
    return true
  if (['radio', 'select'].includes(value.type))
    return list(value.options, (o) => record(o) && text(o.label) && text(o.value))
  if (value.type === 'reference')
    return list(value.choices, (o) => record(o) && text(o.label) && Object.hasOwn(o, 'value'))
  return (
    value.type === 'array' &&
    Array.isArray(value.value) &&
    Array.isArray(value.choices) &&
    record(value.labels)
  )
}

export function validPageRecovery(value: unknown): boolean {
  if (!record(value) || !record(value.owner) || !record(value.snapshot)) return false
  const { snapshot, owner } = value
  return (
    text(owner.collection) &&
    (text(owner.id) || typeof owner.id === 'number') &&
    (owner.locale === undefined || text(owner.locale)) &&
    text(snapshot.revision) &&
    text(snapshot.recoveryUser) &&
    (snapshot.layout === undefined || layout(snapshot.layout)) &&
    dictionary(snapshot.fields, field) &&
    dictionary(snapshot.orders, (rows) => list(rows, row)) &&
    (snapshot.blockTypes === undefined ||
      dictionary(snapshot.blockTypes, (types) =>
        list(types, (type) => record(type) && text(type.slug) && text(type.label)),
      )) &&
    dictionary(value.changes, () => true) &&
    dictionary(value.orders, (ids) => list(ids, text)) &&
    dictionary(value.additions, (rows) =>
      list(rows, (r) => record(r) && text(r.id) && text(r.blockType)),
    ) &&
    dictionary(
      value.media,
      (media) => record(media) && (text(media.id) || typeof media.id === 'number'),
    ) &&
    Object.keys(value.changes).every((path) => Object.hasOwn(snapshot.fields, path)) &&
    Object.keys(value.orders).every((path) => Object.hasOwn(snapshot.orders, path))
  )
}

function nodes(value: unknown): boolean {
  return list(
    value,
    (node) =>
      record(node) &&
      text(node.path) &&
      safePath(node.path) &&
      text(node.label) &&
      text(node.type) &&
      (node.children === undefined || nodes(node.children)) &&
      (node.rows === undefined || list(node.rows, (r) => row(r) && nodes(r.children))) &&
      (node.options === undefined ||
        list(node.options, (o) => record(o) && text(o.label) && text(o.value))) &&
      (node.relations === undefined || list(node.relations, text)) &&
      (node.blocks === undefined ||
        list(node.blocks, (b) => record(b) && text(b.label) && text(b.value))),
  )
}
function operation(value: unknown): boolean {
  if (!record(value) || !safePath(value.path)) return false
  return (
    value.type === 'set' ||
    (['add', 'remove', 'move'].includes(value.type) &&
      text(value.id) &&
      (value.blockType === undefined || text(value.blockType)) &&
      (value.to === undefined || Number.isInteger(value.to)))
  )
}
export function validSharedRecovery(value: unknown): boolean {
  if (!record(value) || !record(value.target)) return false
  return (
    text(value.target.slug) &&
    text(value.target.label) &&
    (value.target.id === undefined || text(value.target.id)) &&
    [value.base, value.snapshot].every(
      (s) =>
        record(s) &&
        text(s.revision) &&
        text(s.recoveryUser) &&
        (s.layout === undefined || layout(s.layout)) &&
        nodes(s.nodes) &&
        record(s.document),
    ) &&
    list(value.operations, operation) &&
    [value.undo, value.redo].every((stack) => list(stack, (ops) => list(ops, operation)))
  )
}
