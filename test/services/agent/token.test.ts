import {expect} from 'chai'
import {Buffer} from 'node:buffer'
import {createHmac} from 'node:crypto'

import {decodeForestUser, mintAgentToken} from '../../../src/services/agent/token.js'

const SECRET = 'test-auth-secret'

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>
}

const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')

function makeToken(payload: unknown): string {
  return `${part({alg: 'HS256'})}.${part(payload)}.sig`
}

describe('agent/token.mintAgentToken', () => {
  it('produces a HS256 JWT signed with the authSecret (byte-compatible signature)', () => {
    const token = mintAgentToken(SECRET, {renderingId: 42}, {now: () => 1_000_000})
    const [header, payload, signature] = token.split('.')

    expect(decodeSegment(header)).to.deep.equal({alg: 'HS256', typ: 'JWT'})

    const expected = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
    expect(signature).to.equal(expected)
  })

  it('sets iat/exp from the injected clock and default 10-min expiry', () => {
    const token = mintAgentToken(SECRET, {renderingId: 7}, {now: () => 1_000_000})
    const payload = decodeSegment(token.split('.')[1])

    expect(payload.iat).to.equal(1000) // 1_000_000 ms -> 1000 s
    expect(payload.exp).to.equal(1600) // +600 s
    expect(payload.renderingId).to.equal(7)
  })

  it('honours a custom expiry and carries optional id/email claims', () => {
    const token = mintAgentToken(
      SECRET,
      {email: 'a@b.com', id: 5, renderingId: 9},
      {expiresInSeconds: 30, now: () => 0},
    )
    const payload = decodeSegment(token.split('.')[1])

    expect(payload).to.include({email: 'a@b.com', exp: 30, iat: 0, id: 5, renderingId: 9})
  })
})

describe('agent/token.decodeForestUser', () => {
  it('reads the nested session-token shape', () => {
    const token = makeToken({data: {data: {attributes: {email: 'me@forest.test'}, id: '141281'}}})
    expect(decodeForestUser(token)).to.deep.equal({email: 'me@forest.test', id: 141_281})
  })

  it('falls back to a flat {id,email} payload', () => {
    expect(decodeForestUser(makeToken({email: 'x@y.z', id: 3}))).to.deep.equal({email: 'x@y.z', id: 3})
  })

  it('returns {} for a malformed token', () => {
    expect(decodeForestUser('not-a-jwt')).to.deep.equal({})
  })
})
