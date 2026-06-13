/**
 * Resolve how to reach the running agent: its base URL and the `authSecret`
 * used to mint a session token.
 *
 * `authSecret` precedence: `--auth-secret` > `$FOREST_AUTH_SECRET` >
 * `<project-dir>/.env`. `agentUrl`: `--agent-url` (used as-is, `/forest` added
 * if missing) > `http://localhost:<port>` where port = `--port` >
 * `<project-dir>/.env` AGENT_PORT > 3310. The URL must be the agent ROOT
 * (no `/forest`): agent-client already prefixes `/forest/` on every route, so a
 * trailing `/forest` is stripped to avoid hitting `/forest/forest/...`.
 */
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {AgentError} from './errors.js'

export type AgentConnectionFlags = {
  'agent-url'?: string
  'auth-secret'?: string
  port?: number
  'project-dir'?: string
}

export type AgentConnection = {
  agentUrl: string
  authSecret: string
}

const DEFAULT_PORT = 3310

/** Minimal `.env` parser: `KEY=VALUE` lines, surrounding quotes stripped. */
function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = /^\s*([\dA-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) out[match[1]] = match[2].replaceAll(/^["']|["']$/g, '')
  }

  return out
}

/** Normalize to the agent ROOT URL: no trailing slash, and strip a trailing `/forest`. */
function toAgentRoot(rawUrl: string): string {
  return rawUrl.replace(/\/+$/, '').replace(/\/forest$/, '')
}

export async function resolveAgentConnection(
  flags: AgentConnectionFlags,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentConnection> {
  let fileEnv: Record<string, string> = {}
  if (flags['project-dir']) {
    const envPath = join(flags['project-dir'], '.env')
    try {
      fileEnv = parseEnvFile(await readFile(envPath, 'utf8'))
    } catch {
      throw new AgentError(`Cannot read ${envPath} — check --project-dir.`)
    }
  }

  const authSecret = flags['auth-secret'] ?? env.FOREST_AUTH_SECRET ?? fileEnv.FOREST_AUTH_SECRET
  if (!authSecret) {
    throw new AgentError(
      'FOREST_AUTH_SECRET not found. Provide --auth-secret, the FOREST_AUTH_SECRET environment ' +
        'variable, or --project-dir pointing at the agent directory (which contains its .env).',
    )
  }

  const port = flags.port ?? (Number(fileEnv.AGENT_PORT) || DEFAULT_PORT)
  const agentUrl = toAgentRoot(flags['agent-url'] ?? `http://localhost:${port}`)

  return {agentUrl, authSecret}
}
