/**
 * Shared plumbing for the `public-api` topic: flags, the login → scope → public
 * client orchestration, query/date helpers, and output. Lives under services/ so
 * oclif doesn't treat it as a command.
 *
 * Auth note: the scope is resolved against the private API with the user's session
 * token, while the public API is called with `--api-token`/`$FOREST_API_TOKEN` when
 * provided (a long-lived application token), otherwise the same session token.
 */
import type {Command} from '@oclif/core'

import {Flags} from '@oclif/core'

import type {LayoutScope} from '../layout/types.js'

import {AuthError, ensureLoggedIn} from '../auth.js'
import {applyInsecure, commonFlags, makeClient} from '../cli-helpers.js'
import {resolvePublicApiUrl} from '../config.js'
import {ScopeError, resolveScope} from '../layout/scope.js'
import {realPrompts, realSelect} from '../prompts.js'
import {PublicApiClient, type PublicApiResult, type QueryValue} from './client.js'
import {PublicApiError} from './errors.js'

/** Flags shared by every `public-api` subcommand. */
export const publicApiFlags = {
  ...commonFlags,
  'api-token': Flags.string({
    description: 'Long-lived application token for the public API (default: $FOREST_API_TOKEN or your session)',
  }),
  env: Flags.string({description: 'Environment (name or id)'}),
  project: Flags.string({description: 'Forest project (name or id)'}),
  'public-api-url': Flags.string({
    description: 'Public API base URL (default: $FOREST_PUBLIC_API_URL or derived from --server)',
  }),
  team: Flags.string({description: 'Team (name or id)'}),
  yes: Flags.boolean({char: 'y', default: false, description: 'Non-interactive mode (no prompts)'}),
}

/** Filter flags common to all three resources. */
export const commonFilterFlags = {
  'created-after': Flags.string({description: 'Only entries created on/after this date (ISO, e.g. 2026-06-01)'}),
  'created-before': Flags.string({description: 'Only entries created on/before this date (ISO, e.g. 2026-06-30)'}),
  limit: Flags.integer({default: 10, description: 'Max number of records to return (1-100)'}),
  'user-email': Flags.string({description: 'Filter by user email'}),
  'user-id': Flags.integer({description: 'Filter by user id'}),
}

export type PublicApiFlags = {
  'api-token'?: string
  env?: string
  insecure: boolean
  oauth: boolean
  project?: string
  'public-api-url'?: string
  server?: string
  team?: string
  verbose: boolean
  yes: boolean
}

export type PublicApiContext = {
  client: PublicApiClient
  scope: LayoutScope
}

/**
 * Authenticate, resolve the scope (project/env names), build the public-API client,
 * run `fn`, and map any typed error to a clean CLI exit.
 */
export async function withPublicApi(
  cmd: Command,
  flags: PublicApiFlags,
  fn: (ctx: PublicApiContext) => Promise<void>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const interactive = !flags.yes && Boolean(process.stdout.isTTY)
  applyInsecure(flags.insecure, m => cmd.warn(m))
  const {client: privateClient, serverUrl} = makeClient(flags, m => cmd.log(m))

  try {
    const {token: sessionToken} = await ensureLoggedIn({
      client: privateClient,
      interactive,
      log: m => cmd.log(m),
      oauth: flags.oauth,
      prompts: realPrompts,
      serverUrl,
    })

    const scope = await resolveScope({
      client: privateClient,
      flags: {env: flags.env, project: flags.project, team: flags.team},
      interactive,
      prompts: {select: realSelect},
      serverUrl,
    })

    const client = new PublicApiClient({
      baseUrl: resolvePublicApiUrl(flags['public-api-url'], serverUrl, env),
      logger: m => cmd.log(m),
      token: flags['api-token'] || env.FOREST_API_TOKEN || sessionToken,
      verbose: flags.verbose,
    })

    await fn({client, scope})
  } catch (error) {
    if (error instanceof PublicApiError || error instanceof ScopeError || error instanceof AuthError) {
      cmd.error(error.message)
    }

    throw error
  }
}

/** Validate an ISO date flag and return its normalized ISO string (throws on bad input). */
function toIso(label: string, value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    throw new PublicApiError(0, `Invalid ${label} date: « ${value} ». Use an ISO date, e.g. 2026-06-01.`)
  }

  return new Date(timestamp).toISOString()
}

/** Build `<field>.gte` / `<field>.lte` query params from after/before flags. */
export function dateRange(field: string, after?: string, before?: string): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {}
  if (after !== undefined) out[`${field}.gte`] = toIso(`--created-after (${field})`, after)
  if (before !== undefined) out[`${field}.lte`] = toIso(`--created-before (${field})`, before)

  return out
}

/** Query params shared by all three resources (limit, user, createdAt range). */
export function commonFilters(flags: {
  'created-after'?: string
  'created-before'?: string
  limit?: number
  'user-email'?: string
  'user-id'?: number
}): Record<string, QueryValue> {
  return {
    limit: flags.limit,
    userEmail: flags['user-email'],
    userId: flags['user-id'],
    ...dateRange('createdAt', flags['created-after'], flags['created-before']),
  }
}

/** Print the result's records, warning when more are available. */
export function printResult(cmd: Command, result: PublicApiResult<unknown>): void {
  cmd.log(JSON.stringify(result.data, null, 2))
  if (result.hasMore) cmd.warn('More results available — raise --limit (max 100) to see more.')
}
