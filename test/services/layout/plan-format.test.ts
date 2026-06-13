import {expect} from 'chai'

import type {PlannedOp} from '../../../src/services/layout/types.js'

import {ForestApiError} from '../../../src/services/api-client.js'
import {explainApiError, formatPlan} from '../../../src/services/layout/plan-format.js'

const op = (overrides: Partial<PlannedOp>): PlannedOp => ({
  domain: 'layout',
  label: 'label',
  op: 'replace',
  path: '/collections/customers/displayName',
  yamlPath: 'layout.collections[customers].displayName',
  ...overrides,
})

describe('layout/plan-format.formatPlan', () => {
  it('renders an empty plan as a success message', () => {
    expect(formatPlan([], [])).to.contain('No changes')
  })

  it('groups ops by domain with op prefixes and a final count', () => {
    const plan = formatPlan(
      [
        op({label: 'layout.collections[customers].displayName: « A » → « B »'}),
        op({domain: 'folders', label: 'folders[u1].name: « X » → « Y »', path: '/folders/u1/name'}),
      ],
      ['layout.collections[customers].modelName: this field cannot be removed'],
    )

    expect(plan).to.contain('layout (1 change)')
    expect(plan).to.contain('folders (1 change)')
    expect(plan).to.contain('~ layout.collections')
    expect(plan).to.contain('⚠')
    expect(plan).to.contain('2 operations to send (1 PATCH /api/layout, 1 PATCH /api/folders)')
  })
})

describe('layout/plan-format.explainApiError', () => {
  it('maps a 422 not-supported patch back to the YAML path', () => {
    const sent = [op({path: '/collections/customers/modelName', yamlPath: 'layout.collections[customers].modelName'})]
    const error = new ForestApiError(422, "Not-supported patch: {op:'replace',path:'/collections/customers/modelName'}")

    const message = explainApiError(error, sent)
    expect(message).to.contain('layout.collections[customers].modelName')
    expect(message).to.contain('422')
  })

  it('explains a 403 with a premium pack op', () => {
    const sent = [op({op: 'add', path: '/dashboards/-', premiumPack: 'multipleDashboards', yamlPath: 'layout.dashboards'})]
    const message = explainApiError(new ForestApiError(403, 'Forbidden'), sent)
    expect(message).to.contain('multipleDashboards')
  })

  it('explains a 403 without premium ops as a permissions issue', () => {
    const message = explainApiError(new ForestApiError(403, 'Forbidden'), [op({})])
    expect(message).to.contain('role')
  })
})
