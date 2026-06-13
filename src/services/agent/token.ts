/**
 * Forge a session token the running agent accepts.
 *
 * The agent validates incoming tokens with `koa-jwt({ secret: authSecret })` and
 * signs its own with `jsonwebtoken.sign(user, authSecret)` (HS256). So a JWT we
 * sign locally with the SAME `authSecret` (the `FOREST_AUTH_SECRET` from the
 * agent's `.env`) is accepted — no browser OAuth round-trip needed.
 *
 * Verified against the live agent: the only claim the permission layer requires
 * is `renderingId` (it loads the rendering's permissions from the Forest server).
 * `id`/`email` are included best-effort (useful when roles are enabled).
 */
import {Buffer} from 'node:buffer'
import {createHmac} from 'node:crypto'

export type AgentTokenClaims = {
  email?: string
  id?: number | string
  renderingId: number
}

export type MintOptions = {
  expiresInSeconds?: number
  now?: () => number
}

const base64url = (input: string): string => Buffer.from(input).toString('base64url')

/**
 * Mint a short-lived HS256 JWT signed with `authSecret`, byte-compatible with
 * `jsonwebtoken.verify`. Default expiry 10 min — the token grants full agent
 * access, so it is kept ephemeral and never persisted.
 */
export function mintAgentToken(authSecret: string, claims: AgentTokenClaims, options: MintOptions = {}): string {
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000)
  const payload = {...claims, exp: nowSeconds + (options.expiresInSeconds ?? 600), iat: nowSeconds}

  const signingInput = `${base64url(JSON.stringify({alg: 'HS256', typ: 'JWT'}))}.${base64url(JSON.stringify(payload))}`
  const signature = createHmac('sha256', authSecret).update(signingInput).digest('base64url')

  return `${signingInput}.${signature}`
}

/**
 * Best-effort extraction of the Forest user identity from a Forest token,
 * tolerating both the session-token shape (`data.data.{id,attributes.email}`)
 * and a flat `{id,email}` payload. Returns `{}` when undecodable.
 */
export function decodeForestUser(token: string): {email?: string; id?: number} {
  const parts = token.split('.')
  if (parts.length !== 3) return {}

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      data?: {data?: {attributes?: {email?: string}; id?: number | string}}
      email?: string
      id?: number | string
    }
    const nested = payload.data?.data
    const rawId = nested?.id ?? payload.id
    const email = nested?.attributes?.email ?? payload.email

    return {email, id: rawId === undefined ? undefined : Number(rawId)}
  } catch {
    return {}
  }
}
