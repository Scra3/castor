/**
 * Authentication flow shared by the `login` command and `init`.
 *
 * Token resolution precedence:
 *   1. `FOREST_TOKEN` environment variable (used as-is, trusted)
 *   2. a non-expired token previously saved on disk for this server
 *   3. an interactive email/password (+ TOTP) prompt, whose result is persisted
 *
 * In non-interactive mode (`--yes`) only steps 1-2 are allowed; if neither
 * yields a token we throw with an actionable message.
 */
import {hostname} from 'node:os'

import {ForestApiClient, ForestApiError} from './api-client.js'
import {isTokenExpired, loadToken, saveToken} from './credentials.js'
import {loginWithOAuth} from './oauth.js'

/** Server error fragments we branch on (see authentication-errors.ts server-side). */
const SERVER_ERROR = {
  badCredentials: 'Invalid username or password',
  invalidTotp: 'two-factor authentication code is invalid',
  passwordUnavailable: 'cannot login with a password',
  twoFactorRequired: 'second factor of authentication',
}

/** Minimal prompt surface, injectable so tests don't touch a real TTY. */
export type AuthPrompts = {
  input(message: string): Promise<string>
  password(message: string): Promise<string>
}

export type EnsureLoggedInOptions = {
  /** Name attached to the created application token (defaults to host name). */
  appTokenName?: string
  client: ForestApiClient
  credentialsPath?: string
  env?: NodeJS.ProcessEnv
  interactive: boolean
  log?: (message: string) => void
  /** When true, use the OAuth/OIDC device flow instead of email/password. */
  oauth?: boolean
  /** Injectable OAuth flow (tests); returns the OIDC access token. */
  oauthLogin?: (serverUrl: string) => Promise<string>
  prompts: AuthPrompts
  serverUrl: string
}

/**
 * Result of a login. `email`/`password` are only present when the user entered
 * them interactively this run (not for env token / stored token / OAuth), so a
 * caller can echo them back as copy/paste credentials.
 */
export type LoginResult = {
  email?: string
  password?: string
  token: string
}

/** Raised when login cannot proceed; carries an actionable, user-facing message. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

const MAX_CREDENTIAL_ATTEMPTS = 3
const MAX_TOTP_ATTEMPTS = 3

function includesError(error: unknown, fragment: string): boolean {
  return error instanceof ForestApiError && error.status === 401 && error.detail.includes(fragment)
}

/**
 * Run the interactive email/password (+ TOTP) login loop, returning the session
 * token on success. Throws AuthError on exhausted attempts or SSO-only accounts.
 */
async function interactiveLogin(
  client: ForestApiClient,
  prompts: AuthPrompts,
  log: (message: string) => void,
): Promise<LoginResult> {
  for (let attempt = 1; attempt <= MAX_CREDENTIAL_ATTEMPTS; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    const email = await prompts.input('Email Forest Admin')
    // eslint-disable-next-line no-await-in-loop
    const password = await prompts.password('Mot de passe')

    try {
      // eslint-disable-next-line no-await-in-loop
      const session = await client.login(email, password)

      return {email, password, token: session.token}
    } catch (error) {
      if (includesError(error, SERVER_ERROR.twoFactorRequired)) {
        return totpLogin(client, prompts, email, password, log)
      }

      if (includesError(error, SERVER_ERROR.passwordUnavailable)) {
        throw new AuthError(
          'Ce compte se connecte via SSO/Google. Relance avec --oauth (ou fournis FOREST_TOKEN).',
        )
      }

      if (includesError(error, SERVER_ERROR.badCredentials)) {
        log(`Email ou mot de passe incorrect. (tentative ${attempt}/${MAX_CREDENTIAL_ATTEMPTS})`)
         
        continue
      }

      throw error
    }
  }

  throw new AuthError('Échec de connexion après plusieurs tentatives.')
}

/** Prompt for the 2FA code and retry login until it is accepted or attempts run out. */
async function totpLogin(
  client: ForestApiClient,
  prompts: AuthPrompts,
  email: string,
  password: string,
  log: (message: string) => void,
): Promise<LoginResult> {
  for (let attempt = 1; attempt <= MAX_TOTP_ATTEMPTS; attempt++) {
    // eslint-disable-next-line no-await-in-loop
    const code = await prompts.input('Code 2FA')

    try {
      // eslint-disable-next-line no-await-in-loop
      const session = await client.login(email, password, code)

      return {email, password, token: session.token}
    } catch (error) {
      if (includesError(error, SERVER_ERROR.invalidTotp)) {
        log(`Code 2FA invalide. (tentative ${attempt}/${MAX_TOTP_ATTEMPTS})`)
         
        continue
      }

      throw error
    }
  }

  throw new AuthError('Code 2FA invalide après plusieurs tentatives.')
}

/**
 * Resolve a valid bearer token, set it on the client, and return it.
 * Persists tokens obtained through the interactive prompt.
 */
export async function ensureLoggedIn(options: EnsureLoggedInOptions): Promise<LoginResult> {
  const {appTokenName, client, credentialsPath, interactive, oauth, oauthLogin, prompts, serverUrl} = options
  const env = options.env ?? process.env
  const log = options.log ?? (() => {})

  const envToken = env.FOREST_TOKEN
  if (envToken) {
    client.setToken(envToken)

    return {token: envToken}
  }

  const fileToken = await loadToken(serverUrl, credentialsPath)
  if (fileToken && !isTokenExpired(fileToken)) {
    client.setToken(fileToken)

    return {token: fileToken}
  }

  if (!interactive) {
    throw new AuthError(
      'Aucune session valide. Définis FOREST_TOKEN, ou lance `forest-onboard login` (mode interactif).',
    )
  }

  const result = oauth
    ? await oauthExchange(client, serverUrl, appTokenName, oauthLogin, log)
    : await interactiveLogin(client, prompts, log)

  client.setToken(result.token)
  await saveToken(serverUrl, result.token, credentialsPath)

  return result
}

/**
 * Run the OAuth device flow, then exchange the short-lived OIDC access token for
 * a persistable application token.
 */
async function oauthExchange(
  client: ForestApiClient,
  serverUrl: string,
  appTokenName: string | undefined,
  oauthLogin: ((serverUrl: string) => Promise<string>) | undefined,
  log: (message: string) => void,
): Promise<LoginResult> {
  const runOAuth = oauthLogin ?? (url => loginWithOAuth(url, {log}))
  const accessToken = await runOAuth(serverUrl)

  client.setToken(accessToken)

  return {token: await client.createApplicationToken(appTokenName ?? `forest-onboard @${hostname()}`)}
}
