import {expect} from 'chai'

import {resolvePublicApiUrl} from '../../../src/services/config.js'
import {commonFilters, dateRange} from '../../../src/services/public-api/command.js'
import {PublicApiError} from '../../../src/services/public-api/errors.js'

describe('public-api/command', () => {
  describe('dateRange', () => {
    it('maps after/before to <field>.gte/.lte normalized to ISO', () => {
      expect(dateRange('createdAt', '2026-06-01', '2026-06-30')).to.deep.equal({
        'createdAt.gte': '2026-06-01T00:00:00.000Z',
        'createdAt.lte': '2026-06-30T00:00:00.000Z',
      })
    })

    it('omits absent bounds', () => {
      expect(dateRange('updatedAt', '2026-06-01')).to.deep.equal({'updatedAt.gte': '2026-06-01T00:00:00.000Z'})
      expect(dateRange('updatedAt')).to.deep.equal({})
    })

    it('throws PublicApiError on an invalid date', () => {
      expect(() => dateRange('createdAt', 'not-a-date')).to.throw(PublicApiError, /Invalid/)
    })
  })

  describe('commonFilters', () => {
    it('maps shared flags to query params and folds in the createdAt range', () => {
      expect(
        commonFilters({
          'created-after': '2026-06-01',
          limit: 20,
          'user-email': 'a@b.com',
          'user-id': 7,
        }),
      ).to.deep.equal({
        'createdAt.gte': '2026-06-01T00:00:00.000Z',
        limit: 20,
        userEmail: 'a@b.com',
        userId: 7,
      })
    })
  })

  describe('resolvePublicApiUrl', () => {
    it('prefers the explicit flag, stripping a trailing slash', () => {
      expect(resolvePublicApiUrl('https://custom.example.com/', 'https://api.forestadmin.com', {})).to.equal(
        'https://custom.example.com',
      )
    })

    it('falls back to $FOREST_PUBLIC_API_URL', () => {
      expect(resolvePublicApiUrl(undefined, 'https://api.forestadmin.com', {FOREST_PUBLIC_API_URL: 'https://x.io'})).to.equal(
        'https://x.io',
      )
    })

    it('derives public-api.* from an api.* server host', () => {
      expect(resolvePublicApiUrl(undefined, 'https://api.forestadmin.com', {})).to.equal(
        'https://public-api.forestadmin.com',
      )
      expect(resolvePublicApiUrl(undefined, 'https://api.development.forestadmin.com', {})).to.equal(
        'https://public-api.development.forestadmin.com',
      )
    })

    it('defaults to production when the host cannot be derived (e.g. localhost)', () => {
      expect(resolvePublicApiUrl(undefined, 'http://localhost:3001', {})).to.equal('https://public-api.forestadmin.com')
    })
  })
})
