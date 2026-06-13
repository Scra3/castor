/**
 * Shared plumbing for the `agent` command topic: common flags, the
 * login → scope → connect orchestration, and small output/parse helpers.
 * Lives under services/ (not commands/) so oclif doesn't treat it as a command.
 */
import type {SelectOptions} from '@forestadmin/agent-client'
import type {Command} from '@oclif/core'

import {Flags} from '@oclif/core'

import type {ForestApiClient} from '../api-client.js'
import type {LayoutScope} from '../layout/types.js'

import {AuthError, ensureLoggedIn} from '../auth.js'
import {applyInsecure, commonFlags, makeClient} from '../cli-helpers.js'
import {ScopeError, resolveScope} from '../layout/scope.js'
import {realPrompts, realSelect} from '../prompts.js'
import {type RemoteAgent, connectToAgent, mapAgentError} from './client.js'
import {resolveAgentConnection} from './connection.js'
import {AgentError} from './errors.js'

/** Context handed to a command body: the remote agent, scope, and minted token. */
export type AgentContext = {
  agentUrl: string
  client: ForestApiClient
  scope: LayoutScope
  token: string
}

/** Flags shared by every `agent` subcommand. */
export const agentFlags = {
  ...commonFlags,
  'agent-url': Flags.string({description: 'Agent URL (default: http://localhost:<port>)'}),
  'auth-secret': Flags.string({
    description: 'Agent FOREST_AUTH_SECRET (else $FOREST_AUTH_SECRET, or read from --project-dir)',
  }),
  env: Flags.string({description: 'Environment (name or id)'}),
  port: Flags.integer({description: 'Agent port (default: AGENT_PORT from .env, or 3310)'}),
  project: Flags.string({description: 'Forest project (name or id)'}),
  'project-dir': Flags.string({description: 'Scaffolded agent directory — reads its .env for the secret and port'}),
  team: Flags.string({description: 'Team (name or id)'}),
  yes: Flags.boolean({char: 'y', default: false, description: 'Non-interactive mode (no prompts)'}),
}

export type AgentFlags = {
  'agent-url'?: string
  'auth-secret'?: string
  env?: string
  insecure: boolean
  oauth: boolean
  port?: number
  project?: string
  'project-dir'?: string
  server?: string
  team?: string
  verbose: boolean
  yes: boolean
}

/**
 * Authenticate, resolve the scope, connect to the agent, run `fn`, and map any
 * typed error to a clean CLI exit. The body's failures are wrapped as AgentError.
 */
export async function withAgent(
  cmd: Command,
  flags: AgentFlags,
  fn: (agent: RemoteAgent, ctx: AgentContext) => Promise<void>,
): Promise<void> {
  const interactive = !flags.yes && Boolean(process.stdout.isTTY)
  applyInsecure(flags.insecure, m => cmd.warn(m))
  const {client, serverUrl} = makeClient(flags, m => cmd.log(m))

  try {
    const {token} = await ensureLoggedIn({
      client,
      interactive,
      log: m => cmd.log(m),
      oauth: flags.oauth,
      prompts: realPrompts,
      serverUrl,
    })

    const scope = await resolveScope({
      client,
      flags: {env: flags.env, project: flags.project, team: flags.team},
      interactive,
      prompts: {select: realSelect},
      serverUrl,
    })

    const {agentUrl, authSecret} = await resolveAgentConnection(flags)
    const {agent, token: agentToken} = await connectToAgent({agentUrl, authSecret, client, forestToken: token, scope})

    try {
      await fn(agent, {agentUrl, client, scope, token: agentToken})
    } catch (error) {
      if (error instanceof AgentError) throw error
      throw mapAgentError(error, agentUrl)
    }
  } catch (error) {
    if (error instanceof AgentError || error instanceof ScopeError || error instanceof AuthError) {
      cmd.error(error.message)
    }

    throw error
  }
}

/** Pretty-print a value as JSON to stdout. */
export function printJson(cmd: Command, value: unknown): void {
  cmd.log(JSON.stringify(value, null, 2))
}

/** Parse and validate a `--data` JSON object flag. */
export function parseDataFlag(raw: string | undefined): Record<string, unknown> {
  if (!raw) throw new AgentError('Provide the data with --data \'{"field":"value"}\'.')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AgentError('--data must be valid JSON.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AgentError('--data must be a JSON object (e.g. \'{"email":"a@b.com"}\').')
  }

  return parsed as Record<string, unknown>
}

/** Parse an optional JSON flag (filter condition tree); undefined when absent. */
export function parseJsonFlag(raw: string | undefined, label: string): unknown {
  if (raw === undefined) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    throw new AgentError(`${label} must be valid JSON.`)
  }
}

/** Flags accepted by query-shaped commands (list/count/relation/export). */
export type QueryFlags = {
  fields?: string
  filter?: string
  page?: number
  'page-size'?: number
  search?: string
  sort?: string
}

/**
 * Build agent-client `SelectOptions` from query flags. `--sort` is a field name,
 * prefix with `-` for descending. `--fields` is comma-separated. `--filter` is a
 * JSON condition tree. Pagination is included only when a page size is given.
 */
export function buildSelectOptions(flags: QueryFlags, {paginate = true}: {paginate?: boolean} = {}): SelectOptions {
  const options: SelectOptions = {}

  if (flags.search) options.search = flags.search
  if (flags.fields) options.fields = flags.fields.split(',').map(field => field.trim()).filter(Boolean)

  if (flags.sort) {
    const descending = flags.sort.startsWith('-')
    options.sort = {ascending: !descending, field: descending ? flags.sort.slice(1) : flags.sort}
  }

  const filter = parseJsonFlag(flags.filter, '--filter')
  if (filter !== undefined) options.filters = filter as SelectOptions['filters']

  if (paginate && flags['page-size'] !== undefined) {
    options.pagination = {number: flags.page ?? 1, size: flags['page-size']}
  }

  return options
}

/** Query flags reused across commands. */
export const queryFlags = {
  fields: Flags.string({description: 'Fields to return (comma-separated)'}),
  filter: Flags.string({description: 'Filter: JSON condition tree (e.g. \'{"field":"email","operator":"Contains","value":"a"}\')'}),
  page: Flags.integer({default: 1, description: 'Page number'}),
  'page-size': Flags.integer({default: 20, description: 'Page size'}),
  search: Flags.string({description: 'Full-text search'}),
  sort: Flags.string({description: 'Sort by field (prefix with "-" for descending)'}),
}
