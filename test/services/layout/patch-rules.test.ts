import {expect} from 'chai'

import {matchesWhitelist} from '../../../src/services/layout/patch-rules.js'

describe('layout/patch-rules.matchesWhitelist', () => {
  it('accepts one representative path per category (names, ints, uuids)', () => {
    const accepted: Array<['folders' | 'layout' | 'workflows', string, string]> = [
      ['layout', 'replace', '/collections/customers/displayName'],
      ['layout', 'replace', '/collections/customers/layout/columns/email/position'],
      ['layout', 'replace', '/collections/customers/layout/fields/email/widgetEdit'],
      ['layout', 'add', '/collections/customers/layout/segments/-'],
      ['layout', 'remove', '/collections/customers/layout/segments/1842'],
      ['layout', 'replace', '/collections/customers/layout/segments/1842/columns/email/isVisible'],
      ['layout', 'replace', '/collections/customers/layout/actions/42/buttonType'],
      ['layout', 'replace', '/collections/customers/layout/viewEdit/summaryView'],
      ['layout', 'add', '/collections/customers/layout/viewEdit/charts/-'],
      ['layout', 'remove', '/collections/customers/layout/viewEdit/charts/11111111-1111-4111-8111-111111111111/filter'],
      ['layout', 'add', '/dashboards/-'],
      ['layout', 'replace', '/dashboards/7/name'],
      ['layout', 'replace', '/sections'],
      ['folders', 'replace', '/folders/7a0096ed-f46a-4269-9491-f28bde765504/children/customers/position'],
      ['folders', 'add', '/folders/-'],
      ['workflows', 'replace', '/workflows/0f9e0000-0000-4000-8000-000000000000/name'],
    ]

    for (const [domain, op, path] of accepted) {
      expect(matchesWhitelist(domain, {op, path}), `${op} ${path}`).to.equal(true)
    }
  })

  it('rejects non-whitelisted paths and ops', () => {
    const rejected: Array<['folders' | 'layout' | 'workflows', string, string]> = [
      ['layout', 'replace', '/collections/customers/modelName'],
      ['layout', 'move', '/collections/customers/displayName'],
      ['layout', 'remove', '/collections/customers'],
      ['layout', 'replace', '/collections/customers/layout/columns/email/displayName'],
      ['folders', 'replace', '/folders/abc def/name'],
      ['workflows', 'replace', '/workflows/42-not-uuid/name'],
    ]

    for (const [domain, op, path] of rejected) {
      expect(matchesWhitelist(domain, {op, path}), `${op} ${path}`).to.equal(false)
    }
  })
})
