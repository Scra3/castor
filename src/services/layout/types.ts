/** Shared types for the layout commands. */

export type LayoutDomain = 'folders' | 'layout' | 'workflows'

export const LAYOUT_DOMAINS: LayoutDomain[] = ['layout', 'folders', 'workflows']

export type JsonPatchOp = {
  op: 'add' | 'remove' | 'replace' | 'test'
  path: string
  value?: unknown
}

/** A diff-produced operation, enriched for display and error mapping. */
export type PlannedOp = JsonPatchOp & {
  domain: LayoutDomain
  /** Human label, e.g. « collections.customers.displayName : “A” → “B” ». */
  label: string
  /** Premium pack required by this op, when any (for 403 explanation). */
  premiumPack?: string
  /** Where this came from in the YAML, e.g. layout.collections[customers].displayName. */
  yamlPath: string
}

/** Fully-resolved patch scope (ids + names, names used in GET URLs). */
export type LayoutScope = {
  environmentId: number
  environmentName: string
  projectId: number
  projectName: string
  serverUrl: string
  teamId: number
  teamName: string
}

/** Parsed content of forest-layout.yml (any domain may be absent). */
export type LayoutFileDoc = {
  folders?: unknown[]
  layout?: unknown
  workflows?: unknown[]
}
