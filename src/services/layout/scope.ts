/**
 * Resolves the patch scope (project / environment / team) from, in order:
 * explicit flags (name or id) > the forest-layout.yml header > smart defaults
 * (single project, development environment, "Operations" team) > interactive
 * picker. Non-interactive mode fails with an actionable ScopeError instead.
 */
import type {ForestApiClient} from '../api-client.js'
import type {LayoutScope} from './types.js'

export class ScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScopeError'
  }
}

export type ScopePrompts = {
  select<T>(message: string, choices: Array<{name: string; value: T}>): Promise<T>
}

export type ResolveScopeOptions = {
  client: ForestApiClient
  flags: {env?: string; project?: string; team?: string}
  fromFile?: Partial<LayoutScope>
  interactive: boolean
  prompts: ScopePrompts
  serverUrl: string
}

type Candidate = {id: string; name: string; type?: string}

function findByFlag(kind: string, flag: string, candidates: Candidate[]): Candidate {
  const match =
    candidates.find(c => c.id === flag) ?? candidates.find(c => c.name.toLowerCase() === flag.toLowerCase())

  if (!match) {
    const available = candidates.map(c => `${c.name} (#${c.id})`).join(', ') || 'aucun'
    throw new ScopeError(`${kind} « ${flag} » introuvable. Disponibles : ${available}.`)
  }

  return match
}

async function pick(
  kind: string,
  flagLabel: string,
  candidates: Candidate[],
  options: {
    defaultOf?: (list: Candidate[]) => Candidate | undefined
    flag?: string
    fromFileId?: number
    interactive: boolean
    prompts: ScopePrompts
  },
): Promise<Candidate> {
  if (options.flag) return findByFlag(kind, options.flag, candidates)

  if (options.fromFileId !== undefined) {
    const fromFile = candidates.find(c => Number(c.id) === options.fromFileId)
    if (fromFile) return fromFile
    // The header points at something gone — fall through to normal resolution.
  }

  if (candidates.length === 1) return candidates[0]

  const preferred = options.defaultOf?.(candidates)
  if (preferred) return preferred

  if (!options.interactive) {
    const available = candidates.map(c => c.name).join(', ') || 'aucun'
    throw new ScopeError(`Plusieurs ${kind.toLowerCase()}s possibles : précise ${flagLabel}. Disponibles : ${available}.`)
  }

  if (candidates.length === 0) throw new ScopeError(`Aucun ${kind.toLowerCase()} disponible sur ce compte.`)

  return options.prompts.select(
    kind,
    candidates.map(c => ({name: c.name, value: c})),
  )
}

/** Resolve the full scope (ids + names). */
export async function resolveScope(options: ResolveScopeOptions): Promise<LayoutScope> {
  const {client, flags, fromFile, interactive, prompts, serverUrl} = options

  const project = await pick('Projet', '--project', await client.listProjects(), {
    flag: flags.project,
    fromFileId: fromFile?.projectId,
    interactive,
    prompts,
  })

  const environment = await pick('Environnement', '--env', await client.listEnvironments(project.id), {
    defaultOf: list => list.find(e => e.type === 'development') ?? list.find(e => e.name === 'Development'),
    flag: flags.env,
    fromFileId: fromFile?.environmentId,
    interactive,
    prompts,
  })

  const team = await pick('Équipe', '--team', await client.listTeams(project.id), {
    defaultOf: list => list.find(t => t.name === 'Operations'),
    flag: flags.team,
    fromFileId: fromFile?.teamId,
    interactive,
    prompts,
  })

  return {
    environmentId: Number(environment.id),
    environmentName: environment.name,
    projectId: Number(project.id),
    projectName: project.name,
    serverUrl,
    teamId: Number(team.id),
    teamName: team.name,
  }
}
