/**
 * Build a ready-to-use remote agent client: fetch the scope's renderingId from
 * the Forest server, mint a session token from the agent's authSecret, and hand
 * back `@forestadmin/agent-client`'s RemoteAgentClient. The agent-client factory
 * is injectable so the orchestration is unit-testable without network.
 */
import {createRemoteAgentClient} from '@forestadmin/agent-client'

import type {ForestApiClient} from '../api-client.js'
import type {LayoutScope} from '../layout/types.js'

import {AgentError} from './errors.js'
import {decodeForestUser, mintAgentToken} from './token.js'

export type RemoteAgent = ReturnType<typeof createRemoteAgentClient>
export type AgentClientFactory = (params: {token?: string; url: string}) => RemoteAgent

/** A connected agent plus the minted session token (needed for direct CSV streaming). */
export type ConnectedAgent = {
  agent: RemoteAgent
  token: string
}

export type ConnectToAgentOptions = {
  agentUrl: string
  authSecret: string
  client: ForestApiClient
  factory?: AgentClientFactory
  forestToken: string
  scope: LayoutScope
}

/** Resolve renderingId → mint token → create the remote client. */
export async function connectToAgent(options: ConnectToAgentOptions): Promise<ConnectedAgent> {
  const {agentUrl, authSecret, client, factory = createRemoteAgentClient, forestToken, scope} = options

  let renderingId: number
  try {
    const rendering = await client.getRendering(scope.projectName, scope.environmentName, scope.teamName)
    renderingId = Number(rendering.data.id)
  } catch {
    throw new AgentError(
      `Could not fetch the rendering for ${scope.projectName} / ${scope.environmentName} / ${scope.teamName}.`,
    )
  }

  if (!Number.isFinite(renderingId)) throw new AgentError('No renderingId found for this scope.')

  const user = decodeForestUser(forestToken)
  const token = mintAgentToken(authSecret, {email: user.email, id: user.id, renderingId})

  return {agent: factory({token, url: agentUrl}), token}
}

/** Translate an agent-client / network failure into an actionable AgentError. */
export function mapAgentError(error: unknown, agentUrl: string): AgentError {
  const message = error instanceof Error ? error.message : String(error)

  if (/econnrefused|econnreset|fetch failed|enotfound|etimedout|socket hang up/i.test(message)) {
    return new AgentError(`Agent unreachable at ${agentUrl}. Is it running? (cd <project> && npm start)`)
  }

  try {
    const status = (JSON.parse(message) as {error?: {status?: number}}).error?.status
    if (status === 401 || status === 403) {
      return new AgentError(
        'Access denied by the agent. Check that --auth-secret (or the .env in --project-dir) matches ' +
          'the FOREST_AUTH_SECRET of the running agent.',
      )
    }

    if (status === 404) return new AgentError('Not found: collection or record does not exist?')
    if (status === 422) return new AgentError('Request rejected by the agent (422) — check the fields/filters sent.')
    if (typeof status === 'number') return new AgentError(`Agent error (HTTP ${status}).`)
  } catch {
    // message wasn't the agent-client JSON envelope — fall through.
  }

  return new AgentError(`Agent error: ${message}`)
}
