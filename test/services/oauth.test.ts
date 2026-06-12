/* eslint-disable camelcase -- OIDC wire format is snake_case (RFC 6749 / 8628) */
import {expect} from 'chai'

import {OAuthError, loginWithOAuth} from '../../src/services/oauth.js'

const DISCOVERY = {
  device_authorization_endpoint: 'http://localhost:3001/oidc/device/auth',
  registration_endpoint: 'http://localhost:3001/oidc/reg',
  token_endpoint: 'http://localhost:3001/oidc/token',
}

/** Build a fake fetch that routes by URL and returns scripted token responses. */
function makeFetch(tokenResponses: Array<{body: unknown; status: number}>) {
  const tokenQueue = [...tokenResponses]

  return (url: string): Promise<Response> => {
    if (url.includes('openid-configuration')) {
      return Promise.resolve(new Response(JSON.stringify(DISCOVERY), {status: 200}))
    }

    if (url.endsWith('/oidc/reg')) {
      return Promise.resolve(new Response(JSON.stringify({client_id: 'client-123'}), {status: 201}))
    }

    if (url.endsWith('/oidc/device/auth')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            device_code: 'dev-code',
            expires_in: 600,
            interval: 1,
            user_code: 'ABCD-1234',
            verification_uri: 'http://localhost:4200/oidc/confirm',
            verification_uri_complete: 'http://localhost:4200/oidc/confirm?user_code=ABCD-1234',
          }),
          {status: 200},
        ),
      )
    }

    // token endpoint
    const next = tokenQueue.shift() ?? {body: {error: 'expired_token'}, status: 400}

    return Promise.resolve(new Response(JSON.stringify(next.body), {status: next.status}))
  }
}

const silentDeps = {
  log() {},
  now: () => 0,
  openBrowser() {},
  sleep: () => Promise.resolve(),
}

describe('oauth.loginWithOAuth', () => {
  it('polls through authorization_pending then returns the access token', async () => {
    const fetchImpl = makeFetch([
      {body: {error: 'authorization_pending'}, status: 400},
      {body: {error: 'authorization_pending'}, status: 400},
      {body: {access_token: 'access-xyz'}, status: 200},
    ])

    const token = await loginWithOAuth('http://localhost:3001', {...silentDeps, fetch: fetchImpl})

    expect(token).to.equal('access-xyz')
  })

  it('throws when the device code expires', async () => {
    const fetchImpl = makeFetch([{body: {error: 'expired_token'}, status: 400}])

    try {
      await loginWithOAuth('http://localhost:3001', {...silentDeps, fetch: fetchImpl})
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(OAuthError)
      expect((error as OAuthError).message).to.contain('expiré')
    }
  })

  it('surfaces an unexpected OIDC error with its description', async () => {
    const fetchImpl = makeFetch([{body: {error: 'access_denied', error_description: 'Refusé par l’utilisateur'}, status: 400}])

    try {
      await loginWithOAuth('http://localhost:3001', {...silentDeps, fetch: fetchImpl})
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as OAuthError).message).to.contain('Refusé')
    }
  })

  it('honours the verification URL and user code passed to the log', async () => {
    const logs: string[] = []
    const fetchImpl = makeFetch([{body: {access_token: 'a'}, status: 200}])

    await loginWithOAuth('http://localhost:3001', {...silentDeps, fetch: fetchImpl, log: m => logs.push(m)})

    const joined = logs.join('\n')
    expect(joined).to.contain('ABCD-1234')
    expect(joined).to.contain('http://localhost:4200/oidc/confirm')
  })
})
