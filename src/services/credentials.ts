/**
 * Persistence of the Forest Admin session token on disk.
 *
 * Stored at `~/.config/forest-onboard/credentials.json` with strict permissions
 * (file 0600, directory 0700) since it holds a bearer token. The token is keyed
 * by server URL so credentials for prod and a local dev stack don't clobber each
 * other.
 */
import {Buffer} from 'node:buffer'
import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {dirname, join} from 'node:path'

export type StoredCredentials = {
  /** Map of server URL -> bearer token. */
  tokens: Record<string, string>
}

const CONFIG_DIR = join(homedir(), '.config', 'forest-onboard')
const CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.json')

/** Exposed for tests that need to assert on the on-disk location. */
export function getCredentialsPath(): string {
  return CREDENTIALS_PATH
}

async function readStore(path: string): Promise<StoredCredentials> {
  try {
    const content = await readFile(path, 'utf8')
    const parsed = JSON.parse(content) as Partial<StoredCredentials>

    return {tokens: parsed.tokens ?? {}}
  } catch {
    // Missing or corrupted file -> behave as an empty store.
    return {tokens: {}}
  }
}

/** Read the token stored for a given server, or null if none. */
export async function loadToken(serverUrl: string, path: string = CREDENTIALS_PATH): Promise<null | string> {
  const store = await readStore(path)

  return store.tokens[serverUrl] ?? null
}

/** Persist the token for a given server, creating the config dir if needed. */
export async function saveToken(serverUrl: string, token: string, path: string = CREDENTIALS_PATH): Promise<void> {
  await mkdir(dirname(path), {mode: 0o700, recursive: true})

  const store = await readStore(path)
  store.tokens[serverUrl] = token

  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, {encoding: 'utf8', mode: 0o600})
}

/** Remove the token for a given server (no-op if absent). */
export async function clearToken(serverUrl: string, path: string = CREDENTIALS_PATH): Promise<void> {
  const store = await readStore(path)

  if (store.tokens[serverUrl] === undefined) return

  delete store.tokens[serverUrl]

  if (Object.keys(store.tokens).length === 0) {
    await rm(path, {force: true})

    return
  }

  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, {encoding: 'utf8', mode: 0o600})
}

/**
 * Decode the `exp` claim (seconds since epoch) of a JWT without verifying its
 * signature. Returns null when the token is malformed or has no expiry.
 */
export function getTokenExpiry(token: string): null | number {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {exp?: number}

    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

/**
 * True when the token is absent, malformed, or expired (with a 60s safety
 * margin so we don't hand out a token that dies mid-request).
 */
export function isTokenExpired(token: string, nowSeconds: number = Date.now() / 1000): boolean {
  const exp = getTokenExpiry(token)
  if (exp === null) return true

  return exp <= nowSeconds + 60
}
