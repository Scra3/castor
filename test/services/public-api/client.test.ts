import {expect} from 'chai'

import {PublicApiClient} from '../../../src/services/public-api/client.js'
import {PublicApiError} from '../../../src/services/public-api/errors.js'

type Call = {init?: RequestInit; url: string}

/** A fake fetch returning a fixed response, recording the calls it received. */
function fakeFetch(
  status: number,
  body: unknown,
  headers?: Record<string, string>,
): {calls: Call[]; impl: (url: string, init?: RequestInit) => Promise<Response>} {
  const calls: Call[] = []
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({init, url})
    const payload = typeof body === 'string' ? body : JSON.stringify(body)

    return new Response(payload, {headers, status})
  }

  return {calls, impl}
}

describe('PublicApiClient', () => {
  const baseUrl = 'https://public-api.forestadmin.com'

  it('builds the query string, dropping undefined values and encoding both sides', async () => {
    const {calls, impl} = fakeFetch(200, {data: [{id: '1'}], hasMore: false})
    const client = new PublicApiClient({baseUrl: `${baseUrl}/`, fetch: impl, token: 't'})

    const result = await client.get('/v1/project/Acme%20Co/activity-logs', {
      collectionName: 'customers',
      limit: 3,
      recordId: undefined,
      userEmail: 'a@b.com',
    })

    expect(calls[0].url).to.equal(
      'https://public-api.forestadmin.com/v1/project/Acme%20Co/activity-logs?collectionName=customers&limit=3&userEmail=a%40b.com',
    )
    expect(result).to.deep.equal({data: [{id: '1'}], hasMore: false, parameters: undefined})
  })

  it('sends the Bearer token and defaults to no query string', async () => {
    const {calls, impl} = fakeFetch(200, {data: [], hasMore: true, parameters: {limit: 10}})
    const client = new PublicApiClient({baseUrl, fetch: impl, token: 'secret-token'})

    const result = await client.get('/v1/project/p/admin-logs')

    expect(calls[0].url).to.equal('https://public-api.forestadmin.com/v1/project/p/admin-logs')
    expect((calls[0].init?.headers as Record<string, string>).Authorization).to.equal('Bearer secret-token')
    expect(result.hasMore).to.equal(true)
    expect(result.parameters).to.deep.equal({limit: 10})
  })

  it('maps 401 to a re-login hint', async () => {
    const {impl} = fakeFetch(401, {code: 'Unauthorized', message: 'Invalid token'})
    const client = new PublicApiClient({baseUrl, fetch: impl, token: 't'})

    const error = await client.get('/v1/x').catch((error_: unknown) => error_)
    expect(error).to.be.instanceOf(PublicApiError)
    expect((error as PublicApiError).status).to.equal(401)
    expect((error as PublicApiError).message).to.contain('--api-token')
  })

  it('maps 403 to a no-access message', async () => {
    const {impl} = fakeFetch(403, {message: 'Forbidden'})
    const client = new PublicApiClient({baseUrl, fetch: impl, token: 't'})

    const error = await client.get('/v1/x').catch((error_: unknown) => error_)
    expect((error as PublicApiError).message).to.contain('no access')
  })

  it('maps 402 PaymentRequiredError to a plan message including the feature', async () => {
    const {impl} = fakeFetch(402, {
      code: 'PaymentRequiredError',
      details: {feature: 'activityLogsPublicAPI'},
      message: 'Feature is not active on project',
    })
    const client = new PublicApiClient({baseUrl, fetch: impl, token: 't'})

    const error = await client.get('/v1/x').catch((error_: unknown) => error_)
    expect((error as PublicApiError).status).to.equal(402)
    expect((error as PublicApiError).message).to.contain('activityLogsPublicAPI')
    expect((error as PublicApiError).message).to.contain('not enabled on your Forest plan')
  })

  it('maps 429 including the Retry-After header', async () => {
    const {impl} = fakeFetch(429, {message: 'Too many requests'}, {'retry-after': '30'})
    const client = new PublicApiClient({baseUrl, fetch: impl, token: 't'})

    const error = await client.get('/v1/x').catch((error_: unknown) => error_)
    expect((error as PublicApiError).message).to.contain('Retry after 30s')
  })

  it('falls back to "<message> (<code>)" for other errors', async () => {
    const {impl} = fakeFetch(400, {code: 'BadRequest', message: 'Invalid filter'})
    const client = new PublicApiClient({baseUrl, fetch: impl, token: 't'})

    const error = await client.get('/v1/x').catch((error_: unknown) => error_)
    expect((error as PublicApiError).message).to.equal('Invalid filter (BadRequest)')
  })

  it('never logs the token in verbose mode', async () => {
    const logs: string[] = []
    const {impl} = fakeFetch(200, {data: [], hasMore: false})
    const client = new PublicApiClient({baseUrl, fetch: impl, logger: m => logs.push(m), token: 'super-secret', verbose: true})

    await client.get('/v1/x', {limit: 1})

    const joined = logs.join('\n')
    expect(joined).to.not.contain('super-secret')
    expect(joined).to.contain('GET https://public-api.forestadmin.com/v1/x')
  })
})
