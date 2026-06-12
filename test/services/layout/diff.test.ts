import {expect} from 'chai'
import {readFile} from 'node:fs/promises'

import {diffDomain} from '../../../src/services/layout/diff.js'
import {renderingToCanonical} from '../../../src/services/layout/rendering-mapper.js'
import {LayoutFileError} from '../../../src/services/layout/yaml-file.js'

async function loadCanonical() {
  const raw = await readFile(new URL('../../fixtures/rendering-doc.json', import.meta.url), 'utf8')

  return renderingToCanonical(JSON.parse(raw))
}

async function loadFolders() {
  const raw = await readFile(new URL('../../fixtures/folders-doc.json', import.meta.url), 'utf8')

  return JSON.parse(raw) as unknown[]
}

const clone = <T>(value: T): T => structuredClone(value)

/** Canonical fixture with one segment on the first collection. */
async function withSegment() {
  const remote = await loadCanonical()
  remote.collections[0].layout.segments = [
    {filter: {aggregator: 'and', conditions: []}, id: 1842, isVisible: true, name: 'VIP', position: 0},
  ]

  return remote
}

describe('layout/diff — golden no-op', () => {
  it('produces zero op/warning when local equals remote (layout, real fixture)', async () => {
    const remote = await loadCanonical()
    const result = diffDomain('layout', remote, clone(remote))
    expect(result.ops).to.deep.equal([])
    expect(result.warnings).to.deep.equal([])
  })

  it('produces zero op for folders and workflows fixtures', async () => {
    const folders = await loadFolders()
    expect(diffDomain('folders', folders, clone(folders)).ops).to.deep.equal([])
    expect(diffDomain('workflows', [], []).ops).to.deep.equal([])
  })
})

describe('layout/diff — collections', () => {
  it('replaces a scalar (displayName) addressing the collection by id', async () => {
    const remote = await loadCanonical()
    const local = clone(remote)
    local.collections.find(c => c.id === 'customers')!.displayName = 'Clients'

    const {ops} = diffDomain('layout', remote, local)

    expect(ops).to.have.length(1)
    expect(ops[0]).to.include({op: 'replace', path: '/collections/customers/displayName'})
    expect(ops[0].value).to.equal('Clients')
    expect(ops[0].yamlPath).to.equal('layout.collections[customers].displayName')
    expect(ops[0].label).to.contain('Customers').and.to.contain('Clients')
  })

  it('replaces with null (not remove) when a value is set to null', async () => {
    const remote = await loadCanonical()
    const local = clone(remote)
    local.collections[0].defaultSortingFieldName = null

    const {ops} = diffDomain('layout', remote, local)
    const op = ops.find(o => o.path.endsWith('defaultSortingFieldName'))
    expect(op?.op).to.equal('replace')
    expect(op?.value).to.equal(null)
  })

  it('replaces a column isVisible', async () => {
    const remote = await loadCanonical()
    const local = clone(remote)
    const column = local.collections.find(c => c.id === 'customers')!.layout.columns.find(c => c.id === 'email')!
    column.isVisible = false

    const {ops} = diffDomain('layout', remote, local)
    expect(ops).to.have.length(1)
    expect(ops[0].path).to.equal('/collections/customers/layout/columns/email/isVisible')
    expect(ops[0].value).to.equal(false)
  })

  it('swaps two column positions as two replace ops', async () => {
    const remote = await loadCanonical()
    const local = clone(remote)
    const {columns} = local.collections[0].layout
    const [a, b] = columns
    ;[a.position, b.position] = [b.position, a.position]

    const {ops} = diffDomain('layout', remote, local)
    expect(ops).to.have.length(2)
    expect(ops.every(op => op.op === 'replace' && op.path.endsWith('/position'))).to.equal(true)
  })

  it('replaces a field property', async () => {
    const remote = await loadCanonical()
    const local = clone(remote)
    const field = local.collections.find(c => c.id === 'customers')!.layout.fields.find(f => f.id === 'email')!
    field.isReadOnly = true

    const {ops} = diffDomain('layout', remote, local)
    expect(ops[0].path).to.equal('/collections/customers/layout/fields/email/isReadOnly')
  })

  it('warns (no op) when adding an element to a schema-defined array (columns)', async () => {
    const remote = await loadCanonical()
    const local = clone(remote)
    local.collections[0].layout.columns.push({id: 'ghost', isVisible: true, position: 99})

    const {ops, warnings} = diffDomain('layout', remote, local)
    expect(ops).to.deep.equal([])
    expect(warnings).to.have.length(1)
    expect(warnings[0]).to.contain('ghost')
  })
})

describe('layout/diff — segments (keyed array with add/remove)', () => {
  it('adds a segment written without id, ordering adds before replaces', async () => {
    const remote = await withSegment()
    const local = clone(remote)
    local.collections[0].displayName = 'Clients' // a replace alongside
    local.collections[0].layout.segments.push({isVisible: true, name: 'Nouveaux', position: 1})

    const {ops} = diffDomain('layout', remote, local)
    expect(ops[0].op).to.equal('add')
    expect(ops[0].path).to.equal('/collections/customers/layout/segments/-')
    expect(ops[0].value).to.deep.equal({isVisible: true, name: 'Nouveaux', position: 1})
    expect(ops[0].premiumPack).to.equal('scopes')
    expect(ops[1].op).to.equal('replace')
  })

  it('removes a segment by its remote id', async () => {
    const remote = await withSegment()
    const local = clone(remote)
    local.collections[0].layout.segments = []

    const {ops} = diffDomain('layout', remote, local)
    expect(ops).to.have.length(1)
    expect(ops[0]).to.include({op: 'remove', path: '/collections/customers/layout/segments/1842'})
  })

  it('renames a segment via a single replace on .../name (id stable)', async () => {
    const remote = await withSegment()
    const local = clone(remote)
    local.collections[0].layout.segments[0].name = 'VIP Gold'

    const {ops} = diffDomain('layout', remote, local)
    expect(ops).to.have.length(1)
    expect(ops[0]).to.include({op: 'replace', path: '/collections/customers/layout/segments/1842/name'})
  })

  it('replaces the whole columns array of a segment when items are added (fallback)', async () => {
    const remote = await withSegment()
    ;(remote.collections[0].layout.segments[0] as Record<string, unknown>).columns = [
      {id: 'email', isVisible: true, position: 0},
    ]
    const local = clone(remote)
    ;(local.collections[0].layout.segments[0] as Record<string, unknown>).columns = [
      {id: 'email', isVisible: true, position: 0},
      {id: 'created_at', isVisible: true, position: 1},
    ]

    const {ops} = diffDomain('layout', remote, local)
    expect(ops).to.have.length(1)
    expect(ops[0].op).to.equal('replace')
    expect(ops[0].path).to.equal('/collections/customers/layout/segments/1842/columns')
    expect(ops[0].value).to.be.an('array').with.length(2)
  })

  it('emits a fine-grained op when only a segment column property changes', async () => {
    const remote = await withSegment()
    ;(remote.collections[0].layout.segments[0] as Record<string, unknown>).columns = [
      {id: 'email', isVisible: true, position: 0},
    ]
    const local = clone(remote)
    const cols = (local.collections[0].layout.segments[0] as {columns: Array<{isVisible: boolean}>}).columns
    cols[0].isVisible = false

    const {ops} = diffDomain('layout', remote, local)
    expect(ops).to.have.length(1)
    expect(ops[0].path).to.equal('/collections/customers/layout/segments/1842/columns/email/isVisible')
  })
})

describe('layout/diff — charts, dashboards, sections', () => {
  it('handles chart add / property replace / property remove / chart remove with ordering', async () => {
    const remote = await loadCanonical()
    const ve = remote.collections[0].layout.viewEdit as unknown as Record<string, unknown>
    ve.charts = [
      {filter: {x: 1}, id: '11111111-1111-4111-8111-111111111111', name: 'A', type: 'Value'},
      {id: '22222222-2222-4222-8222-222222222222', name: 'B', type: 'Value'},
    ]
    const local = clone(remote)
    const localVe = local.collections[0].layout.viewEdit as unknown as {charts: Array<Record<string, unknown>>}
    delete localVe.charts[0].filter // property remove
    localVe.charts[0].name = 'A2' // property replace
    localVe.charts.splice(1, 1) // chart remove
    localVe.charts.push({name: 'C', type: 'Leaderboard'}) // chart add (no id)

    const {ops} = diffDomain('layout', remote, local)
    const kinds = ops.map(op => op.op)
    expect(kinds).to.deep.equal(['add', 'replace', 'remove', 'remove'])
    expect(ops[0].path).to.equal('/collections/customers/layout/viewEdit/charts/-')
    expect(ops[1].path).to.equal(
      '/collections/customers/layout/viewEdit/charts/11111111-1111-4111-8111-111111111111/name',
    )
    const removePaths = [ops[2].path, ops[3].path]
    expect(removePaths).to.include('/collections/customers/layout/viewEdit/charts/11111111-1111-4111-8111-111111111111/filter')
    expect(removePaths).to.include('/collections/customers/layout/viewEdit/charts/22222222-2222-4222-8222-222222222222')
  })

  it('flags dashboard additions with the multipleDashboards premium pack', async () => {
    const remote = await loadCanonical()
    const local = clone(remote)
    local.dashboards.push({name: 'KPIs'})

    const {ops} = diffDomain('layout', remote, local)
    expect(ops[0].op).to.equal('add')
    expect(ops[0].path).to.equal('/dashboards/-')
    expect(ops[0].premiumPack).to.equal('multipleDashboards')
  })

  it('replaces sections as a whole block', async () => {
    const remote = await loadCanonical()
    const local = clone(remote)
    ;(local.sections as Array<{isVisible: boolean}>)[0].isVisible = false

    const {ops} = diffDomain('layout', remote, local)
    expect(ops).to.have.length(1)
    expect(ops[0]).to.include({op: 'replace', path: '/sections'})
  })
})

describe('layout/diff — folders & workflows', () => {
  it('renames a folder and moves a child', async () => {
    const remote = await loadFolders()
    const local = clone(remote) as Array<{children: Array<{position: number}>; id: string; name?: string}>
    local[0].name = 'Ventes'
    local[0].children[0].position = 9

    const {ops} = diffDomain('folders', remote, local)
    const paths = ops.map(op => op.path)
    expect(paths).to.include(`/folders/${local[0].id}/name`)
    expect(paths.some(p => p.endsWith('/position'))).to.equal(true)
  })

  it('adds and removes folders', async () => {
    const remote = await loadFolders()
    const local = clone(remote) as unknown[]
    local.push({children: [], name: 'Archives'})

    const {ops} = diffDomain('folders', remote, local)
    expect(ops[0]).to.include({op: 'add', path: '/folders/-'})
    expect((ops[0].value as Record<string, unknown>).name).to.equal('Archives')
  })

  it('diffs workflows by uuid', () => {
    const remote = [{id: '0f9e0000-0000-4000-8000-000000000000', isVisible: true, name: 'Onboarding', position: 0}]
    const local = clone(remote)
    local[0].isVisible = false

    const {ops} = diffDomain('workflows', remote, local)
    expect(ops).to.have.length(1)
    expect(ops[0].path).to.equal('/workflows/0f9e0000-0000-4000-8000-000000000000/isVisible')
  })
})

describe('layout/diff — validation errors', () => {
  it('rejects an item without id nor name', async () => {
    const remote = await loadFolders()
    const local = clone(remote) as unknown[]
    ;(local[0] as {children: unknown[]}).children.push({isVisible: true, position: 5})

    expect(() => diffDomain('folders', remote, local)).to.throw(LayoutFileError, /identifier/)
  })

  it('rejects duplicated identities', async () => {
    const remote = await loadFolders()
    const local = clone(remote) as Array<{children: Array<{id: string}>}>
    local[0].children.push({...local[0].children[0]})

    expect(() => diffDomain('folders', remote, local)).to.throw(LayoutFileError, /même identité/)
  })
})
