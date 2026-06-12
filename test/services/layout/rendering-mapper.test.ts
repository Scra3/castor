import {expect} from 'chai'
import {readFile} from 'node:fs/promises'

import type {CanonicalLayout} from '../../../src/services/layout/rendering-mapper.js'

import {renderingToCanonical} from '../../../src/services/layout/rendering-mapper.js'

async function loadFixture(): Promise<CanonicalLayout> {
  const raw = await readFile(new URL('../../fixtures/rendering-doc.json', import.meta.url), 'utf8')

  return renderingToCanonical(JSON.parse(raw))
}

describe('layout/rendering-mapper', () => {
  it('maps the collections sorted by id with camelCase base props', async () => {
    const canonical = await loadFixture()

    expect(canonical.collections.map(c => c.id)).to.deep.equal(['customers', 'orders', 'products'])
    const customers = canonical.collections[0]
    expect(customers.displayName).to.equal('Customers')
    expect(customers.icon).to.equal('user')
    expect(customers.restrictedToSegments).to.equal(false)
  })

  it('maps columns with isVisible = !is_hidden and strips the collection prefix', async () => {
    const canonical = await loadFixture()
    const customers = canonical.collections.find(c => c.id === 'customers')!

    const ids = customers.layout.columns.map(c => c.id)
    expect(ids).to.include('email')
    expect(ids).to.not.include('customers-email')
    for (const column of customers.layout.columns) {
      expect(column).to.have.all.keys('id', 'isVisible', 'position')
      expect(column.isVisible).to.be.a('boolean')
    }
  })

  it('orders columns by position', async () => {
    const canonical = await loadFixture()
    const positions = canonical.collections[0].layout.columns.map(c => c.position)
    expect([...positions].sort((a, b) => a - b)).to.deep.equal(positions)
  })

  it('maps fields with their patchable props only', async () => {
    const canonical = await loadFixture()
    const email = canonical.collections
      .find(c => c.id === 'customers')!
      .layout.fields.find(f => f.id === 'email')!

    expect(email).to.have.property('displayName')
    expect(email).to.have.property('isReadOnly')
    expect(email).to.not.have.property('is_read_only')
    expect(email).to.not.have.property('type') // non patchable: excluded
  })

  it('exposes sections as-is and dashboards camelized', async () => {
    const canonical = await loadFixture()
    expect(canonical.sections).to.be.an('array')
    expect(canonical.dashboards).to.be.an('array')
  })

  it('is deterministic (two runs produce deep-equal documents)', async () => {
    const [a, b] = [await loadFixture(), await loadFixture()]
    expect(a).to.deep.equal(b)
  })
})
