/**
 * Rebuilds the patchable "layout" document from the serialized rendering.
 *
 * The server has no raw GET for the layout domain (GET /api/layout always
 * returns [] — the renderings table has no `layout` column). The frontend
 * reads the layout through GET /api/renderings/:project/:env/:team, a JSON:API
 * document (snake_case attributes, resources split into `included`). This
 * module inverts that serialization into the configuration shape the PATCH
 * paths address (camelCase, see server validators/models/collection.js).
 *
 * v1 maps the curated, patchable subset (anything else stays reachable via
 * `layout patch`): collections base props, columns, fields, segments, actions,
 * viewEdit.summaryView, sections, dashboards (name/icon/position).
 */
 
import type {JsonApiResource} from '../api-client.js'

type RenderingDoc = {data: JsonApiResource; included?: JsonApiResource[]}

export type CanonicalLayout = {
  collections: CanonicalCollection[]
  dashboards: Array<Record<string, unknown>>
  sections: unknown
}

export type CanonicalCollection = {
  defaultSortingFieldName: null | string
  defaultSortingOrder: null | string
  displayName: null | string
  displayNamePlural: null | string
  icon: null | string
  id: string
  layout: {
    actions: Array<Record<string, unknown>>
    columns: Array<{id: string; isVisible: boolean; position: number}>
    fields: Array<Record<string, unknown>>
    segments: Array<Record<string, unknown>>
    viewEdit: {summaryView: unknown}
  }
  restrictedToSegments: boolean
}

/** `customers-email` -> `email` (resource ids are prefixed by the collection). */
function stripCollectionPrefix(resourceId: string, collectionId: string): string {
  const prefix = `${collectionId}-`

  return resourceId.startsWith(prefix) ? resourceId.slice(prefix.length) : resourceId
}

function indexIncluded(doc: RenderingDoc): Map<string, JsonApiResource> {
  const index = new Map<string, JsonApiResource>()
  for (const resource of doc.included ?? []) index.set(`${resource.type}:${resource.id}`, resource)

  return index
}

function relatedIds(resource: JsonApiResource | undefined, relationship: string): Array<{id: string; type: string}> {
  const data = resource?.relationships?.[relationship]?.data as unknown

  if (Array.isArray(data)) return data as Array<{id: string; type: string}>
  if (data && typeof data === 'object') return [data as {id: string; type: string}]

  return []
}

/** Shallow snake_case -> camelCase for generic resources (segments, actions…). */
function camelizeShallow(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key.replaceAll(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  )
}

function mapColumns(
  collection: JsonApiResource,
  index: Map<string, JsonApiResource>,
): CanonicalCollection['layout']['columns'] {
  const columns: CanonicalCollection['layout']['columns'] = []

  for (const ref of relatedIds(collection, 'columns')) {
    const column = index.get(`columns:${ref.id}`)
    if (!column) continue
    const attrs = column.attributes ?? {}
    columns.push({
      id: stripCollectionPrefix(column.id, collection.id),
      // Wire format exposes is_hidden; the patchable config uses isVisible.
      isVisible: attrs.is_hidden !== true,
      position: (attrs.position as number) ?? 0,
    })
  }

  columns.sort((a, b) => a.position - b.position)

  return columns
}

const FIELD_PATCHABLE_KEYS: Array<[wire: string, canonical: string]> = [
  ['display_name', 'displayName'],
  ['description', 'description'],
  ['is_read_only', 'isReadOnly'],
  ['is_filter_displayed', 'isFilterDisplayed'],
  ['is_dissociate_displayed', 'isDissociateDisplayed'],
  ['widget_edit', 'widgetEdit'],
  ['widget_display', 'widgetDisplay'],
  ['mapping_values', 'mappingValues'],
  ['conditional_formatting', 'conditionalFormatting'],
]

function mapFields(
  collection: JsonApiResource,
  index: Map<string, JsonApiResource>,
): Array<Record<string, unknown>> {
  const fields: Array<Record<string, unknown>> = []

  for (const ref of relatedIds(collection, 'fields')) {
    const field = index.get(`fields:${ref.id}`)
    if (!field) continue
    const attrs = field.attributes ?? {}
    const mapped: Record<string, unknown> = {
      id: (attrs.field as string) ?? stripCollectionPrefix(field.id, collection.id),
    }
    for (const [wire, canonical] of FIELD_PATCHABLE_KEYS) {
      if (wire in attrs) mapped[canonical] = attrs[wire]
    }

    fields.push(mapped)
  }

  fields.sort((a, b) => String(a.id).localeCompare(String(b.id)))

  return fields
}

function mapGenericList(
  collection: JsonApiResource,
  index: Map<string, JsonApiResource>,
  relationship: string,
  includedType: string,
): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = []

  for (const ref of relatedIds(collection, relationship)) {
    const resource = index.get(`${includedType}:${ref.id}`)
    if (!resource) continue
    items.push({id: resource.id, ...camelizeShallow(resource.attributes ?? {})})
  }

  return items
}

function mapCollection(collection: JsonApiResource, index: Map<string, JsonApiResource>): CanonicalCollection {
  const attrs = collection.attributes ?? {}
  const sortingFieldRef = relatedIds(collection, 'default_sorting_field')[0]
  const viewEdit = index.get(`viewEdits:${collection.id}`)

  return {
    defaultSortingFieldName: sortingFieldRef ? stripCollectionPrefix(sortingFieldRef.id, collection.id) : null,
    defaultSortingOrder: (attrs.default_sorting_field_order as string) ?? null,
    displayName: (attrs.display_name as string) ?? null,
    displayNamePlural: (attrs.display_name_plural as string) ?? null,
    icon: (attrs.icon as string) ?? null,
    id: collection.id,
    layout: {
      actions: mapGenericList(collection, index, 'custom_actions', 'customActions'),
      columns: mapColumns(collection, index),
      fields: mapFields(collection, index),
      segments: mapGenericList(collection, index, 'segments', 'segments'),
      viewEdit: {summaryView: (viewEdit?.attributes?.summary_view as unknown) ?? null},
    },
    restrictedToSegments: attrs.restricted_to_segments === true,
  }
}

/** Build the canonical patchable layout document from a rendering response. */
export function renderingToCanonical(doc: RenderingDoc): CanonicalLayout {
  const index = indexIncluded(doc)
  const collections = (doc.included ?? [])
    .filter(resource => resource.type === 'collections')
    .map(collection => mapCollection(collection, index))
    .sort((a, b) => a.id.localeCompare(b.id))

  const dashboards = (doc.included ?? [])
    .filter(resource => resource.type === 'dashboards')
    .map(dashboard => ({id: dashboard.id, ...camelizeShallow(dashboard.attributes ?? {})}))

  return {
    collections,
    dashboards,
    sections: (doc.data.attributes?.sections as unknown) ?? [],
  }
}
