/**
 * OIDC device authorization flow (RFC 8628) against the Forest server.
 *
 * This is how SSO / Google users log in — and how a brand-new account is created
 * (the user signs up in the browser, then confirms the device code). Returns the
 * short-lived OIDC access token; the caller exchanges it for an application token.
 *
 * Implemented with raw fetch (the server's OIDC endpoints accept JSON bodies), so
 * no heavy OAuth dependency is needed. `fetch`/`sleep`/`now` are injectable for tests.
 */
/* eslint-disable camelcase -- OIDC wire format is snake_case (RFC 6749 / 8628) */
import {spawnProcess} from './process-utils.js'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

export type OAuthDeps = {
  fetch?: FetchImpl
  log: (message: string) => void
  now?: () => number
  openBrowser?: (url: string) => void
  sleep?: (ms: number) => Promise<void>
}

export class OAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OAuthError'
  }
}

const REDIRECT_URI = 'com.forestadmin.cli://authenticate'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const SCOPES = 'openid email profile'

type JsonResponse = {data: Record<string, unknown>; ok: boolean; status: number}

async function readJson(response: Response): Promise<JsonResponse> {
  const text = await response.text()
  let data: Record<string, unknown> = {}

  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  } catch {
    data = {}
  }

  return {data, ok: response.ok, status: response.status}
}

function postJson(fetchImpl: FetchImpl, url: string, body: unknown): Promise<JsonResponse> {
  return fetchImpl(url, {
    body: JSON.stringify(body),
    headers: {'Content-Type': 'application/json'},
    method: 'POST',
  }).then(readJson)
}

/** Best-effort: open the verification URL in the user's browser; never throws. */
function defaultOpenBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]]

  try {
    const child = spawnProcess(command as string, args as string[])
    child.on('error', () => {})
  } catch {
    // ignore — printing the URL is enough
  }
}

/** Run the full device flow and resolve with the OIDC access token. */
export async function loginWithOAuth(serverUrl: string, deps: OAuthDeps): Promise<string> {
  const base = serverUrl.replace(/\/+$/, '')
  const fetchImpl = deps.fetch ?? ((input, init) => fetch(input, init))
  const sleep = deps.sleep ?? (ms => new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  }))
  const now = deps.now ?? (() => Date.now())
  const openBrowser = deps.openBrowser ?? defaultOpenBrowser

  // 1. Discover the OIDC endpoints.
  const discovery = await fetchImpl(`${base}/oidc/.well-known/openid-configuration`, {method: 'GET'}).then(readJson)
  if (!discovery.ok) throw new OAuthError(`OIDC discovery failed (HTTP ${discovery.status}).`)

  const registrationEndpoint = discovery.data.registration_endpoint as string
  const deviceEndpoint = discovery.data.device_authorization_endpoint as string
  const tokenEndpoint = discovery.data.token_endpoint as string

  // 2. Register a native client (no secret).
  const registration = await postJson(fetchImpl, registrationEndpoint, {
    application_type: 'native',
    grant_types: [DEVICE_GRANT],
    name: 'castor',
    redirect_uris: [REDIRECT_URI],
    response_types: ['none'],
    token_endpoint_auth_method: 'none',
  })
  if (!registration.ok) throw new OAuthError(`OIDC client registration failed (HTTP ${registration.status}).`)
  const clientId = registration.data.client_id as string

  // 3. Start the device authorization.
  const device = await postJson(fetchImpl, deviceEndpoint, {client_id: clientId, scope: SCOPES})
  if (!device.ok) throw new OAuthError(`OIDC authorization request failed (HTTP ${device.status}).`)

  const verificationUriComplete = (device.data.verification_uri_complete as string) ||
    (device.data.verification_uri as string)
  const verificationUri = (device.data.verification_uri as string) || verificationUriComplete
  const userCode = device.data.user_code as string
  const intervalSeconds = (device.data.interval as number) ?? 5
  const expiresInSeconds = (device.data.expires_in as number) ?? 600

  // 4. Two-step on purpose: the Forest app drops the OIDC return URL after login,
  //    so the user must FIRST have a web session, THEN open the confirm link
  //    (which carries the code as a query param — there is no manual entry field).
  const appBase = new URL(verificationUri).origin
  deps.log('')
  deps.log('Log in through your browser:')
  deps.log(`  1. Log in to Forest (Google, SSO or email): ${appBase}`)
  deps.log('     (you may land on the home page after login — that is normal)')
  deps.log('  2. Once logged in, open this link and confirm the authorization:')
  deps.log('')
  deps.log(`        ${verificationUriComplete}`)
  deps.log('')
  deps.log(`Verification code: ${userCode}`)
  deps.log('Waiting for confirmation… (Ctrl-C to cancel)')
  // Open the app login first; the user re-opens the confirm link once logged in.
  openBrowser(appBase)

  // 5. Poll the token endpoint until the user confirms (or the code expires).
  let intervalMs = intervalSeconds * 1000
  const deadline = now() + expiresInSeconds * 1000

  while (now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs)
    // eslint-disable-next-line no-await-in-loop
    const result = await postJson(fetchImpl, tokenEndpoint, {
      client_id: clientId,
      device_code: device.data.device_code,
      grant_type: DEVICE_GRANT,
    })

    if (result.ok) return result.data.access_token as string

    const error = result.data.error as string | undefined
    if (error === 'authorization_pending') continue
    if (error === 'slow_down') {
      intervalMs += 5000
      continue
    }

    if (error === 'expired_token') throw new OAuthError('The code has expired. Restart the login.')

    throw new OAuthError((result.data.error_description as string) || `OIDC authorization failed (${error ?? result.status}).`)
  }

  throw new OAuthError('Timed out waiting for the OAuth login.')
}
