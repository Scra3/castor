/** Flags and helpers shared by the CLI commands (login, init, ...). */
import {Flags} from '@oclif/core'

import {ForestApiClient} from './api-client.js'
import {resolveServerUrl} from './config.js'
import {spawnProcess} from './process-utils.js'

/** Best-effort: open a URL in the default browser; never throws. */
export function openUrl(url: string): void {
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

/** Flags common to every command that talks to the Forest server. */
export const commonFlags = {
  insecure: Flags.boolean({
    default: false,
    description: 'Disable TLS certificate verification (dev only)',
  }),
  oauth: Flags.boolean({
    default: false,
    description: 'Log in via OAuth/OIDC in the browser (Google/SSO, account creation)',
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
    warn('TLS verification disabled (--insecure). Use only against a trusted dev server.')
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
