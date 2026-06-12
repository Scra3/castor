/** Fetches the patchable documents for the requested domains. */
import type {ForestApiClient} from '../api-client.js'
import type {LayoutDomain, LayoutFileDoc, LayoutScope} from './types.js'

import {renderingToCanonical} from './rendering-mapper.js'

/** Pull the requested domains into the canonical (patch-addressable) shape. */
export async function fetchDomains(
  client: ForestApiClient,
  scope: LayoutScope,
  domains: LayoutDomain[],
): Promise<LayoutFileDoc> {
  const docs: LayoutFileDoc = {}

  if (domains.includes('layout')) {
    // No raw GET for the layout domain: rebuild it from the rendering document.
    const rendering = await client.getRendering(scope.projectName, scope.environmentName, scope.teamName)
    docs.layout = renderingToCanonical(rendering)
  }

  if (domains.includes('folders')) {
    docs.folders = await client.getLayoutDomain('folders', scope.projectName, scope.environmentName, scope.teamName)
  }

  if (domains.includes('workflows')) {
    docs.workflows = await client.getLayoutDomain(
      'workflows',
      scope.projectName,
      scope.environmentName,
      scope.teamName,
    )
  }

  return docs
}

/** Parse and validate a --domains flag value. */
export function parseDomainsFlag(value: string): LayoutDomain[] {
  const domains = value.split(',').map(d => d.trim()) as LayoutDomain[]
  const valid = new Set(['folders', 'layout', 'workflows'])
  for (const domain of domains) {
    if (!valid.has(domain)) {
      throw new TypeError(`Domaine inconnu : « ${domain} ». Valeurs possibles : layout, folders, workflows.`)
    }
  }

  return domains
}
