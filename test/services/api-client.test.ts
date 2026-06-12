/* eslint-disable camelcase -- asserting on snake_case Forest wire attributes */
import {expect} from 'chai'

import {ForestApiClient, ForestApiError} from '../../src/services/api-client.js'

type Call = {init?: RequestInit; url: string}

/** A fake fetch returning a fixed response, recording the calls it received. */
function fakeFetch(status: number, body: unknown): {calls: Call[]; impl: (url: string, init?: RequestInit) => Promise<Response>} {
  const calls: Call[] = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({init, url})
    const payload = typeof body === 'string' ? body : JSON.stringify(body)

    return new Response(payload, {status})
  }

  return {calls, impl}
}

describe('ForestApiClient', () => {
  const serverUrl = 'http://localhost:3001'

  it('logs in and returns the token pair', async () => {
    const {calls, impl} = fakeFetch(200, {refreshToken: 'r1', token: 't1'})
    const client = new ForestApiClient({fetch: impl, serverUrl})

    const session = await client.login('a@b.com', 'secret', '123456')

    expect(session).to.deep.equal({refreshToken: 'r1', token: 't1'})
    expect(calls[0].url).to.equal('http://localhost:3001/api/sessions')
    expect(calls[0].init?.method).to.equal('POST')
    const sentBody = JSON.parse(calls[0].init?.body as string)
    expect(sentBody).to.deep.equal({email: 'a@b.com', password: 'secret', timeBasedOneTimePassword: '123456'})
  })

  it('omits TOTP from the body when not provided', async () => {
    const {calls, impl} = fakeFetch(200, {refreshToken: 'r', token: 't'})
    const client = new ForestApiClient({fetch: impl, serverUrl})

    await client.login('a@b.com', 'secret')

    const sentBody = JSON.parse(calls[0].init?.body as string)
    expect(sentBody).to.not.have.property('timeBasedOneTimePassword')
  })

  it('throws a ForestApiError with parsed JSON:API detail on 401', async () => {
    const {impl} = fakeFetch(401, {errors: [{detail: 'Invalid email or password'}]})
    const client = new ForestApiClient({fetch: impl, serverUrl})

    try {
      await client.login('a@b.com', 'wrong')
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ForestApiError)
      expect((error as ForestApiError).status).to.equal(401)
      expect((error as ForestApiError).detail).to.equal('Invalid email or password')
    }
  })

  it('sends the bearer token on authenticated calls', async () => {
    const {calls, impl} = fakeFetch(200, {secretKey: 'env-secret-key'})
    const client = new ForestApiClient({fetch: impl, serverUrl, token: 'my-token'})

    const secret = await client.getEnvironmentSecretKey('42')

    expect(secret).to.equal('env-secret-key')
    expect(calls[0].url).to.equal('http://localhost:3001/api/environments/42/secretKey')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).to.equal('Bearer my-token')
  })

  it('refuses an authenticated call without a token', async () => {
    const {impl} = fakeFetch(200, {})
    const client = new ForestApiClient({fetch: impl, serverUrl})

    try {
      await client.getEnvironmentSecretKey('42')
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ForestApiError)
      expect((error as ForestApiError).status).to.equal(0)
    }
  })

  it('reads is_active (snake_case) from the environment document', async () => {
    const {impl} = fakeFetch(200, {data: {attributes: {is_active: true}, id: '42', type: 'environments'}})
    const client = new ForestApiClient({fetch: impl, serverUrl, token: 't'})

    expect(await client.getEnvironmentIsActive('42')).to.equal(true)
  })

  it('tolerates camelCase isActive too', async () => {
    const {impl} = fakeFetch(200, {data: {attributes: {isActive: true}, id: '42', type: 'environments'}})
    const client = new ForestApiClient({fetch: impl, serverUrl, token: 't'})

    expect(await client.getEnvironmentIsActive('42')).to.equal(true)
  })

  it('builds the project creation body with agent/postgres attributes', async () => {
    const {calls, impl} = fakeFetch(200, {data: {id: '7', type: 'projects'}})
    const client = new ForestApiClient({fetch: impl, serverUrl, token: 't'})

    await client.createProject('My Project')

    const sentBody = JSON.parse(calls[0].init?.body as string)
    expect(sentBody.data.attributes).to.deep.equal({
      agent: 'agent-nodejs',
      architecture: 'microservice',
      databaseType: 'postgres',
      name: 'My Project',
    })
  })

  it('wraps transport failures as ForestApiError with status 0', async () => {
    const client = new ForestApiClient({
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
      serverUrl,
      token: 't',
    })

    try {
      await client.getEnvironmentIsActive('42')
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ForestApiError)
      expect((error as ForestApiError).status).to.equal(0)
      expect((error as ForestApiError).detail).to.contain('ECONNREFUSED')
    }
  })

  it('exchanges the current token for a long-lived application token', async () => {
    const {calls, impl} = fakeFetch(200, {data: {attributes: {token: 'app-secret'}, id: '1', type: 'application-token'}})
    const client = new ForestApiClient({fetch: impl, serverUrl, token: 'oidc-access'})

    const token = await client.createApplicationToken('forest-onboard @host')

    expect(token).to.equal('app-secret')
    const sentBody = JSON.parse(calls[0].init?.body as string)
    expect(sentBody.data).to.deep.equal({attributes: {name: 'forest-onboard @host'}, type: 'application-tokens'})
  })

  it('throws when the application-token response has no token', async () => {
    const {impl} = fakeFetch(200, {data: {attributes: {}, id: '1', type: 'application-token'}})
    const client = new ForestApiClient({fetch: impl, serverUrl, token: 'oidc-access'})

    try {
      await client.createApplicationToken('x')
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(ForestApiError)
    }
  })

  it('creates an account with the snake_case user attributes', async () => {
    const {calls, impl} = fakeFetch(200, {data: {attributes: {email: 'a@b.com'}, id: '101', type: 'users'}})
    const client = new ForestApiClient({fetch: impl, serverUrl})

    const id = await client.signup({email: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace', password: 'Secret123'})

    expect(id).to.equal('101')
    expect(calls[0].url).to.equal('http://localhost:3001/api/users')
    const sentBody = JSON.parse(calls[0].init?.body as string)
    expect(sentBody.data).to.deep.equal({
      attributes: {email: 'a@b.com', first_name: 'Ada', last_name: 'Lovelace', password: 'Secret123'},
      type: 'users',
    })
  })

  it('redacts sensitive fields in verbose logs', async () => {
    const logs: string[] = []
    const {impl} = fakeFetch(200, {refreshToken: 'r', token: 't'})
    const client = new ForestApiClient({fetch: impl, logger: m => logs.push(m), serverUrl, verbose: true})

    await client.login('a@b.com', 'super-secret')

    const joined = logs.join('\n')
    expect(joined).to.not.contain('super-secret')
    expect(joined).to.contain('***redacted***')
  })
})
