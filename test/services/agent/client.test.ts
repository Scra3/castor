import {expect} from 'chai'
import {Buffer} from 'node:buffer'

import type {ForestApiClient} from '../../../src/services/api-client.js'
import type {LayoutScope} from '../../../src/services/layout/types.js'

import {connectToAgent, mapAgentError} from '../../../src/services/agent/client.js'
import {AgentError} from '../../../src/services/agent/errors.js'

const SCOPE: LayoutScope = {
  environmentId: 1,
  environmentName: 'Development',
  projectId: 2,
  projectName: 'demo',
  serverUrl: 'https://api.forestadmin.com',
  teamId: 3,
  teamName: 'Operations',
}

function fakeClient(rendering: unknown): ForestApiClient {
  return {getRendering: () => Promise.resolve(rendering)} as unknown as ForestApiClient
}

function decodePayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('agent/client.connectToAgent', () => {
  it('resolves renderingId, mints a token, and calls the factory with url + token', async () => {
    const captured: {token?: string; url?: string} = {}
    const sentinel = {marker: 'remote-agent'}

    const {agent, token} = await connectToAgent({
      agentUrl: 'http://localhost:3310',
      authSecret: 'secret',
      client: fakeClient({data: {id: '350497'}}),
      factory(params) {
        captured.token = params.token
        captured.url = params.url

        return sentinel as never
      },
      forestToken: 'header.eyJpZCI6N30.sig', // {"id":7}
      scope: SCOPE,
    })

    expect(agent).to.equal(sentinel)
    expect(captured.url).to.equal('http://localhost:3310')
    expect(token).to.equal(captured.token)
    expect(decodePayload(captured.token as string)).to.include({id: 7, renderingId: 350_497})
  })

  it('throws AgentError when the rendering id is not a number', async () => {
    try {
      await connectToAgent({
        agentUrl: 'http://localhost:3310',
        authSecret: 'secret',
        client: fakeClient({data: {id: 'not-a-number'}}),
        factory: () => ({}) as never,
        forestToken: 'a.b.c',
        scope: SCOPE,
      })
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(AgentError)
    }
  })

  it('wraps a failing getRendering in an AgentError', async () => {
    const client = {getRendering: () => Promise.reject(new Error('boom'))} as unknown as ForestApiClient
    try {
      await connectToAgent({
        agentUrl: 'http://localhost:3310',
        authSecret: 'secret',
        client,
        factory: () => ({}) as never,
        forestToken: 'a.b.c',
        scope: SCOPE,
      })
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(AgentError)
    }
  })
})

describe('agent/client.mapAgentError', () => {
  it('maps connection refusal to a "is it running?" message', () => {
    const mapped = mapAgentError(new Error('connect ECONNREFUSED 127.0.0.1:3310'), 'http://localhost:3310')
    expect(mapped).to.be.instanceOf(AgentError)
    expect(mapped.message).to.contain('unreachable')
  })

  it('maps a 401 envelope to an authSecret hint', () => {
    const mapped = mapAgentError(JSON.stringify({error: {status: 401}}), 'http://localhost:3310')
    expect(mapped.message).to.contain('FOREST_AUTH_SECRET')
  })

  it('maps a 404 envelope to a not-found message', () => {
    const mapped = mapAgentError(JSON.stringify({error: {status: 404}}), 'http://localhost:3310')
    expect(mapped.message).to.contain('Not found')
  })

  it('keeps the raw message for unknown errors', () => {
    const mapped = mapAgentError(new Error('weird failure'), 'http://localhost:3310')
    expect(mapped.message).to.contain('weird failure')
  })
})
