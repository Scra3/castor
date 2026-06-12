/**
 * (De)serialization of forest-layout.yml: a `forest:` header carrying the
 * scope, then one section per domain mirroring the patchable documents 1:1.
 */
import {parseDocument, stringify} from 'yaml'

import type {LayoutFileDoc, LayoutScope} from './types.js'

export class LayoutFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LayoutFileError'
  }
}

const HEADER_COMMENT = ` forest-layout.yml — généré par \`forest-onboard layout pull\`.
 Modifie ce fichier puis lance \`forest-onboard layout diff\` / \`layout apply\`.
 - Les champs \`id\` sont des identifiants : NE PAS les modifier.
 - L'ordre des éléments est porté par le champ \`position\` (pas par l'ordre YAML).
 - Pour ajouter un élément (segment, dashboard, dossier…) : ajoute un bloc sans \`id\`.
 - Pour supprimer un élément : supprime son bloc.
 - Colonnes (columns) : seuls \`position\` et \`isVisible\` sont modifiables.`

/** Serialize the pulled documents with the scope header and guidance comments. */
export function serializeLayoutFile(scope: LayoutScope, docs: LayoutFileDoc, now: () => Date): string {
  const content = {
    forest: {
      environment: {id: scope.environmentId, name: scope.environmentName},
      project: {id: scope.projectId, name: scope.projectName},
      pulledAt: now().toISOString(),
      server: scope.serverUrl,
      team: {id: scope.teamId, name: scope.teamName},
      version: 1,
    },
    ...(docs.layout === undefined ? {} : {layout: docs.layout}),
    ...(docs.folders === undefined ? {} : {folders: docs.folders}),
    ...(docs.workflows === undefined ? {} : {workflows: docs.workflows}),
  }

  const document = parseDocument(stringify(content, {lineWidth: 120}))
  document.commentBefore = HEADER_COMMENT

  return document.toString({lineWidth: 120})
}

/** Parse the file back; tolerates absent domains (partial pulls). */
export function parseLayoutFile(content: string): {docs: LayoutFileDoc; scope: Partial<LayoutScope>} {
  let parsed: unknown
  try {
    parsed = parseDocument(content, {strict: false}).toJS() as unknown
  } catch (error) {
    throw new LayoutFileError(`YAML invalide : ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new LayoutFileError('Fichier de layout vide ou invalide.')
  }

  const root = parsed as Record<string, unknown>
  const header = root.forest as
    | {environment?: {id?: number; name?: string}; project?: {id?: number; name?: string}; server?: string; team?: {id?: number; name?: string}}
    | undefined

  if (!header) {
    throw new LayoutFileError('En-tête `forest:` manquant. Génère le fichier avec `forest-onboard layout pull`.')
  }

  const scope: Partial<LayoutScope> = {
    environmentId: header.environment?.id,
    environmentName: header.environment?.name,
    projectId: header.project?.id,
    projectName: header.project?.name,
    serverUrl: header.server,
    teamId: header.team?.id,
    teamName: header.team?.name,
  }

  return {
    docs: {
      folders: root.folders as undefined | unknown[],
      layout: root.layout,
      workflows: root.workflows as undefined | unknown[],
    },
    scope,
  }
}
