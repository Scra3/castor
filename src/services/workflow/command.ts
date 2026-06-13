/**
 * Shared plumbing for the `workflow` topic: flags, the login → scope → engine-gate
 * → renderingId orchestration, and output helpers. Lives under services/ so oclif
 * doesn't treat it as a command.
 */
import type {Command} from '@oclif/core'

import {Flags} from '@oclif/core'

import type {ForestApiClient} from '../api-client.js'
import type {LayoutScope} from '../layout/types.js'

import {AuthError, ensureLoggedIn} from '../auth.js'
import {applyInsecure, commonFlags, makeClient} from '../cli-helpers.js'
import {ScopeError, resolveScope} from '../layout/scope.js'
import {realPrompts, realSelect} from '../prompts.js'
import {mapWorkflowError} from './client.js'
import {WorkflowError} from './errors.js'

const ORCHESTRATOR = 'orchestrator'

/** Flags shared by every `workflow` subcommand. */
export const workflowFlags = {
  ...commonFlags,
  env: Flags.string({description: 'Environment (name or id)'}),
  project: Flags.string({description: 'Forest project (name or id)'}),
  team: Flags.string({description: 'Team (name or id)'}),
  yes: Flags.boolean({char: 'y', default: false, description: 'Non-interactive mode (no prompts)'}),
}

export type WorkflowFlags = {
  env?: string
  insecure: boolean
  oauth: boolean
  project?: string
  server?: string
  team?: string
  verbose: boolean
  yes: boolean
}

export type WorkflowContext = {
  client: ForestApiClient
  renderingId: number
  scope: LayoutScope
}

type EngineClient = Pick<ForestApiClient, 'getEnvironmentWorkflowEngine'>
type RenderingClient = Pick<ForestApiClient, 'getRendering'>

/** Fail fast unless the environment runs the orchestrator engine. */
export async function assertOrchestratorEngine(client: EngineClient, environmentId: number): Promise<void> {
  const engine = await client.getEnvironmentWorkflowEngine(environmentId)
  if (engine !== ORCHESTRATOR) {
    throw new WorkflowError(
      `This environment uses the '${engine ?? 'unknown'}' workflow engine. The orchestrator API ` +
        "is only available on environments running the 'orchestrator' engine.",
    )
  }
}

/** Resolve the scope's renderingId (required by the orchestrator's header). */
export async function resolveRenderingId(client: RenderingClient, scope: LayoutScope): Promise<number> {
  const rendering = await client.getRendering(scope.projectName, scope.environmentName, scope.teamName)
  const renderingId = Number(rendering.data.id)
  if (!Number.isFinite(renderingId)) throw new WorkflowError('Could not resolve a renderingId for this scope.')

  return renderingId
}

/**
 * Authenticate, resolve the scope, enforce the orchestrator engine, resolve the
 * renderingId, run `fn`, and map any typed error to a clean CLI exit.
 */
export async function withWorkflow(
  cmd: Command,
  flags: WorkflowFlags,
  fn: (ctx: WorkflowContext) => Promise<void>,
): Promise<void> {
  const interactive = !flags.yes && Boolean(process.stdout.isTTY)
  applyInsecure(flags.insecure, m => cmd.warn(m))
  const {client, serverUrl} = makeClient(flags, m => cmd.log(m))

  try {
    await ensureLoggedIn({
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

    await assertOrchestratorEngine(client, scope.environmentId)
    const renderingId = await resolveRenderingId(client, scope)

    try {
      await fn({client, renderingId, scope})
    } catch (error) {
      throw mapWorkflowError(error)
    }
  } catch (error) {
    if (error instanceof WorkflowError || error instanceof ScopeError || error instanceof AuthError) {
      cmd.error(error.message)
    }

    throw error
  }
}

/** Pretty-print a value as JSON to stdout. */
export function printJson(cmd: Command, value: unknown): void {
  cmd.log(JSON.stringify(value, null, 2))
}
