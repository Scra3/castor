import {expect} from 'chai'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {ForestApiClient} from '../../src/services/api-client.js'

import {ForestApiError} from '../../src/services/api-client.js'
import {AuthError, AuthPrompts, ensureLoggedIn} from '../../src/services/auth.js'
import {clearToken, loadToken, saveToken} from '../../src/services/credentials.js'

type LoginImpl = (email: string, password: string, totp?: string) => Promise<{refreshToken: string; token: string}>

/** A fake ForestApiClient recording setToken calls and delegating login to a script. */
function fakeClient(loginImpl: LoginImpl): {client: ForestApiClient; tokens: string[]} {
  const tokens: string[] = []
  const client = {
    login: (email: string, password: string, totp?: string) => loginImpl(email, password, totp),
    setToken(token: string) {
      tokens.push(token)
    },
  } as unknown as ForestApiClient

  return {client, tokens}
}

/** Prompts that hand back queued answers; throws if it runs dry (over-prompting bug). */
function scriptedPrompts(answers: string[]): AuthPrompts {
  const queue = [...answers]
  const next = (): Promise<string> => {
    if (queue.length === 0) throw new Error('scriptedPrompts: no more answers queued')

    return Promise.resolve(queue.shift() as string)
  }

  return {input: () => next(), password: () => next()}
}

function makeJwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({exp})).toString('base64url')

  return `h.${payload}.s`
}

const serverUrl = 'http://localhost:3001'
const noopLog = (): void => {}

describe('auth.ensureLoggedIn', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `forest-onboard-auth-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    await clearToken(serverUrl, path)
  })

  it('uses FOREST_TOKEN when present, without prompting', async () => {
    const {client, tokens} = fakeClient(() => Promise.reject(new Error('should not login')))

    const token = await ensureLoggedIn({
      client,
      credentialsPath: path,
      env: {FOREST_TOKEN: 'env-token'},
      interactive: true,
      prompts: scriptedPrompts([]),
      serverUrl,
    })

    expect(token).to.equal('env-token')
    expect(tokens).to.deep.equal(['env-token'])
  })

  it('uses a valid token from disk', async () => {
    const stored = makeJwt(Date.now() / 1000 + 3600)
    await saveToken(serverUrl, stored, path)
    const {client} = fakeClient(() => Promise.reject(new Error('should not login')))

    const token = await ensureLoggedIn({
      client,
      credentialsPath: path,
      env: {},
      interactive: true,
      prompts: scriptedPrompts([]),
      serverUrl,
    })

    expect(token).to.equal(stored)
  })

  it('ignores an expired disk token and logs in interactively', async () => {
    await saveToken(serverUrl, makeJwt(Date.now() / 1000 - 10), path)
    const {client} = fakeClient(() => Promise.resolve({refreshToken: 'r', token: 'fresh-token'}))

    const token = await ensureLoggedIn({
      client,
      credentialsPath: path,
      env: {},
      interactive: true,
      prompts: scriptedPrompts(['a@b.com', 'pw']),
      serverUrl,
    })

    expect(token).to.equal('fresh-token')
    expect(await loadToken(serverUrl, path)).to.equal('fresh-token')
  })

  it('throws in non-interactive mode when no token is available', async () => {
    const {client} = fakeClient(() => Promise.reject(new Error('should not login')))

    try {
      await ensureLoggedIn({client, credentialsPath: path, env: {}, interactive: false, prompts: scriptedPrompts([]), serverUrl})
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(AuthError)
      expect((error as AuthError).message).to.contain('FOREST_TOKEN')
    }
  })

  it('retries on bad credentials then succeeds', async () => {
    let attempts = 0
    const {client} = fakeClient(() => {
      attempts += 1
      if (attempts === 1) return Promise.reject(new ForestApiError(401, 'Invalid username or password'))

      return Promise.resolve({refreshToken: 'r', token: 'ok-token'})
    })

    const token = await ensureLoggedIn({
      client,
      credentialsPath: path,
      env: {},
      interactive: true,
      log: noopLog,
      prompts: scriptedPrompts(['bad@b.com', 'wrong', 'good@b.com', 'right']),
      serverUrl,
    })

    expect(token).to.equal('ok-token')
    expect(attempts).to.equal(2)
  })

  it('prompts for a 2FA code when the server requires a second factor', async () => {
    const {client} = fakeClient((email, password, totp) => {
      if (!totp) return Promise.reject(new ForestApiError(401, 'A second factor of authentication must be provided'))

      return Promise.resolve({refreshToken: 'r', token: `token-${totp}`})
    })

    const token = await ensureLoggedIn({
      client,
      credentialsPath: path,
      env: {},
      interactive: true,
      log: noopLog,
      prompts: scriptedPrompts(['a@b.com', 'pw', '123456']),
      serverUrl,
    })

    expect(token).to.equal('token-123456')
  })

  it('runs the OAuth flow and exchanges for an application token', async () => {
    const setTokens: string[] = []
    const client = {
      createApplicationToken: (name: string) => Promise.resolve(`app-token-for-${name}`),
      setToken(token: string) {
        setTokens.push(token)
      },
    } as unknown as Parameters<typeof ensureLoggedIn>[0]['client']

    const token = await ensureLoggedIn({
      appTokenName: 'forest-onboard @ci',
      client,
      credentialsPath: path,
      env: {},
      interactive: true,
      oauth: true,
      oauthLogin: () => Promise.resolve('oidc-access-token'),
      prompts: scriptedPrompts([]),
      serverUrl,
    })

    expect(token).to.equal('app-token-for-forest-onboard @ci')
    // First the OIDC access token, then the exchanged application token.
    expect(setTokens).to.deep.equal(['oidc-access-token', 'app-token-for-forest-onboard @ci'])
    expect(await loadToken(serverUrl, path)).to.equal('app-token-for-forest-onboard @ci')
  })

  it('surfaces an SSO-only account with a FOREST_TOKEN hint', async () => {
    const {client} = fakeClient(() =>
      Promise.reject(new ForestApiError(401, 'You cannot login with a password to this account.')),
    )

    try {
      await ensureLoggedIn({
        client,
        credentialsPath: path,
        env: {},
        interactive: true,
        log: noopLog,
        prompts: scriptedPrompts(['a@b.com', 'pw']),
        serverUrl,
      })
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(AuthError)
      expect((error as AuthError).message).to.contain('FOREST_TOKEN')
    }
  })
})
