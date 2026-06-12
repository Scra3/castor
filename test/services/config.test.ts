import {expect} from 'chai'

import {DEFAULT_SERVER_URL, resolveAppUrl, resolveServerUrl} from '../../src/services/config.js'

describe('config.resolveServerUrl', () => {
  it('prefers the --server flag over everything', () => {
    const env = {FOREST_SERVER_URL: 'https://env-server.com', FOREST_URL: 'https://env-url.com'}
    expect(resolveServerUrl('https://flag.com', env)).to.equal('https://flag.com')
  })

  it('falls back to FOREST_URL, then FOREST_SERVER_URL', () => {
    expect(resolveServerUrl(undefined, {FOREST_URL: 'https://a.com'})).to.equal('https://a.com')
    expect(resolveServerUrl(undefined, {FOREST_SERVER_URL: 'https://b.com'})).to.equal('https://b.com')
  })

  it('defaults to production when nothing is set', () => {
    expect(resolveServerUrl(undefined, {})).to.equal(DEFAULT_SERVER_URL)
  })

  it('strips trailing slashes', () => {
    expect(resolveServerUrl('http://localhost:3001/', {})).to.equal('http://localhost:3001')
  })
})

describe('config.resolveAppUrl', () => {
  it('maps the production server to the production app', () => {
    expect(resolveAppUrl(DEFAULT_SERVER_URL)).to.deep.equal({uncertain: false, url: 'https://app.forestadmin.com'})
  })

  it('maps localhost and development to the development app', () => {
    expect(resolveAppUrl('http://localhost:3001').url).to.equal('https://app.development.forestadmin.com')
    expect(resolveAppUrl('https://api.development.forestadmin.com').url).to.equal(
      'https://app.development.forestadmin.com',
    )
  })

  it('echoes an unknown server URL and flags it uncertain', () => {
    expect(resolveAppUrl('https://forest.acme.internal')).to.deep.equal({
      uncertain: true,
      url: 'https://forest.acme.internal',
    })
  })
})
