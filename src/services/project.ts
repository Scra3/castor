/**
 * Creates a Forest project and resolves the bits the agent needs: the default
 * environment id and its secret key (FOREST_ENV_SECRET).
 *
 * Note: the server returns an *existing* project when the name is already taken,
 * so callers should treat `alreadyActive` as a likely name collision.
 */
 
import {ForestApiClient, JsonApiDocument, JsonApiResource} from './api-client.js'

export class ProjectError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectError'
  }
}

export type CreatedProject = {
  /** True when the default environment is already active (agent already connected). */
  alreadyActive: boolean
  envSecret: string
  environmentId: string
  environmentName: string
  projectId: string
}

/** Resolve the default environment id from the project document. */
export function findDefaultEnvironmentId(doc: JsonApiDocument): string {
  const related = doc.data.relationships?.defaultEnvironment?.data
  if (related?.id) return related.id

  const included = doc.included?.find(resource => resource.type === 'environments')
  if (included?.id) return included.id

  throw new ProjectError('Réponse inattendue du serveur : aucun environnement par défaut sur le projet.')
}

function findIncludedEnvironment(doc: JsonApiDocument, environmentId: string): JsonApiResource | undefined {
  return doc.included?.find(resource => resource.type === 'environments' && resource.id === environmentId)
}

/** Create the project and return everything the scaffolder/agent needs. */
export async function createProject(client: ForestApiClient, name: string): Promise<CreatedProject> {
  const doc = await client.createProject(name)
  const projectId = doc.data.id
  const environmentId = findDefaultEnvironmentId(doc)

  const environment = findIncludedEnvironment(doc, environmentId)
  const attributes = environment?.attributes ?? {}
  const environmentName = (attributes.name as string) ?? 'Development'
  // Server serializes in snake_case (is_active); tolerate camelCase too.
  const alreadyActive = (attributes.is_active ?? attributes.isActive) === true

  const envSecret = await client.getEnvironmentSecretKey(environmentId)

  return {alreadyActive, envSecret, environmentId, environmentName, projectId}
}
