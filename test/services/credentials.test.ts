import {expect} from 'chai'
import {stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {clearToken, isTokenExpired, loadToken, saveToken} from '../../src/services/credentials.js'

/** Build a JWT-shaped string with the given `exp` claim (signature ignored). */
function makeJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({alg: 'none', typ: 'JWT'})).toString('base64url')
  const payload = Buffer.from(JSON.stringify({exp})).toString('base64url')

  return `${header}.${payload}.sig`
}

describe('credentials', () => {
  let path: string

  beforeEach(() => {
    path = join(tmpdir(), `castor-creds-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  })

  afterEach(async () => {
    await clearToken('http://localhost:3001', path)
  })

  it('returns null when no token is stored', async () => {
    expect(await loadToken('http://localhost:3001', path)).to.equal(null)
  })

  it('saves and loads a token per server URL', async () => {
    await saveToken('http://localhost:3001', 'token-dev', path)
    await saveToken('https://api.forestadmin.com', 'token-prod', path)

    expect(await loadToken('http://localhost:3001', path)).to.equal('token-dev')
    expect(await loadToken('https://api.forestadmin.com', path)).to.equal('token-prod')
  })

  it('writes the credentials file with 0600 permissions', async () => {
    await saveToken('http://localhost:3001', 'token-dev', path)
    const {mode} = await stat(path)
    // Last 3 octal digits are the permission bits; expect rw------- (600).
    expect(mode.toString(8).slice(-3)).to.equal('600')
  })

  it('clears a token and removes the file when empty', async () => {
    await saveToken('http://localhost:3001', 'token-dev', path)
    await clearToken('http://localhost:3001', path)
    expect(await loadToken('http://localhost:3001', path)).to.equal(null)
  })

  describe('isTokenExpired', () => {
    const now = 1_000_000

    it('treats a malformed token as expired', () => {
      expect(isTokenExpired('not-a-jwt', now)).to.equal(true)
    })

    it('treats a token without exp as expired', () => {
      const noExp = `${Buffer.from('{}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.sig`
      expect(isTokenExpired(noExp, now)).to.equal(true)
    })

    it('treats a token expiring within 60s as expired', () => {
      expect(isTokenExpired(makeJwt(now + 30), now)).to.equal(true)
    })

    it('accepts a token comfortably in the future', () => {
      expect(isTokenExpired(makeJwt(now + 3600), now)).to.equal(false)
    })
  })
})
