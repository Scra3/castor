/**
 * Server / app URL resolution.
 *
 * The CLI can target either Forest Admin production, the development stack, or a
 * fully custom server (e.g. a local `forestadmin-server` on http://localhost:3001).
 */

export const DEFAULT_SERVER_URL = 'https://api.forestadmin.com'

/** Forest's public API (audit/observability). A separate host from the private API. */
export const DEFAULT_PUBLIC_API_URL = 'https://public-api.forestadmin.com'

const PRODUCTION_APP_URL = 'https://app.forestadmin.com'
const DEVELOPMENT_APP_URL = 'https://app.development.forestadmin.com'

/**
 * Resolve the Forest Admin API server URL.
 *
 * Precedence (highest first):
 *   1. the `--server` flag (passed as `flagServer`)
 *   2. the `FOREST_URL` environment variable
 *   3. the `FOREST_SERVER_URL` environment variable
 *   4. the production default
 *
 * The trailing slash, if any, is stripped so callers can safely concatenate paths.
 */
export function resolveServerUrl(flagServer?: string, env: NodeJS.ProcessEnv = process.env): string {
  const raw = flagServer || env.FOREST_URL || env.FOREST_SERVER_URL || DEFAULT_SERVER_URL

  return raw.replace(/\/+$/, '')
}

/** True when the resolved server URL is the production default. */
export function isDefaultServerUrl(serverUrl: string): boolean {
  return serverUrl === DEFAULT_SERVER_URL
}

/**
 * Resolve the Forest public API base URL.
 *
 * Precedence (highest first):
 *   1. the `--public-api-url` flag (passed as `flag`)
 *   2. the `FOREST_PUBLIC_API_URL` environment variable
 *   3. derived from the server URL when its host starts with `api.`
 *      (e.g. `api.development.forestadmin.com` → `public-api.development.forestadmin.com`)
 *   4. the production default
 *
 * A local stack (localhost) cannot be derived — pass `--public-api-url` explicitly.
 * The trailing slash, if any, is stripped.
 */
export function resolvePublicApiUrl(
  flag?: string,
  serverUrl?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = flag || env.FOREST_PUBLIC_API_URL
  if (explicit) return explicit.replace(/\/+$/, '')

  if (serverUrl) {
    try {
      const url = new URL(serverUrl)
      if (url.hostname.startsWith('api.')) {
        url.hostname = `public-api.${url.hostname.slice('api.'.length)}`

        return url.origin
      }
    } catch {
      // not a parseable URL — fall through to the default
    }
  }

  return DEFAULT_PUBLIC_API_URL
}

export type AppUrl = {
  /** True when we could not confidently map the server to a known app URL. */
  uncertain: boolean
  /** The base URL of the web app where the user can open their project. */
  url: string
}

/**
 * Map an API server URL to the matching web-app URL, used only for the final
 * "open your project here" summary. When the server is custom/unknown we cannot
 * guess the app URL, so we echo the server URL and flag it as uncertain.
 */
export function resolveAppUrl(serverUrl: string): AppUrl {
  if (isDefaultServerUrl(serverUrl)) {
    return {uncertain: false, url: PRODUCTION_APP_URL}
  }

  if (serverUrl.includes('development.forestadmin.com') || serverUrl.includes('localhost')) {
    return {uncertain: false, url: DEVELOPMENT_APP_URL}
  }

  return {uncertain: true, url: serverUrl}
}
