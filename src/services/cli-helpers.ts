/** Flags and helpers shared by the CLI commands (login, init, ...). */
import {Flags} from '@oclif/core'

import {ForestApiClient} from './api-client.js'
import {resolveServerUrl} from './config.js'

/** Flags common to every command that talks to the Forest server. */
export const commonFlags = {
  insecure: Flags.boolean({
    default: false,
    description: 'Disable TLS certificate verification (dev only)',
  }),
  oauth: Flags.boolean({
    default: false,
    description: 'Se connecter via OAuth/OIDC dans le navigateur (Google/SSO, création de compte)',
  }),
  server: Flags.string({
    description: 'Forest API server URL (default: $FOREST_URL, $FOREST_SERVER_URL, or production)',
  }),
  verbose: Flags.boolean({
    default: false,
    description: 'Log HTTP requests and responses (secrets redacted)',
  }),
}

/** Disable TLS verification when --insecure is set, warning the user loudly. */
export function applyInsecure(insecure: boolean, warn: (message: string) => void): void {
  if (insecure) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
    warn('Vérification TLS désactivée (--insecure). À n’utiliser que contre un serveur de dev de confiance.')
  }
}

/** Build an API client from parsed flags, returning it with the resolved server URL. */
export function makeClient(
  flags: {server?: string; verbose?: boolean},
  logger: (message: string) => void,
): {client: ForestApiClient; serverUrl: string} {
  const serverUrl = resolveServerUrl(flags.server)
  const client = new ForestApiClient({logger, serverUrl, verbose: flags.verbose})

  return {client, serverUrl}
}
