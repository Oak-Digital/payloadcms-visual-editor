export type SharedTarget = { slug: string; global?: boolean; id?: string; label: string }
export type SharedContentConfig = Record<
  string,
  {
    global?: boolean
    /** Only these document roots can be edited. */
    fields: string[]
    rowLabels?: Record<string, string>
  }
>
export type SharedOperation =
  | { type: 'set'; path: string; value: unknown }
  | { type: 'add'; path: string; id: string; blockType?: string }
  | { type: 'remove' | 'move'; path: string; id: string; to?: number }
export type SharedNode = {
  path: string
  label: string
  type: string
  value?: unknown
  children?: SharedNode[]
  rows?: { id: string; label: string; children: SharedNode[] }[]
  options?: { label: string; value: string }[]
  relations?: string[]
  polymorphic?: boolean
  displayValue?: string
  maxRows?: number
  minRows?: number
  blocks?: { value: string; label: string }[]
}
export type SharedSnapshot = {
  revision: string
  nodes: SharedNode[]
  document: Record<string, any>
  drafts: boolean
  status?: string
}
