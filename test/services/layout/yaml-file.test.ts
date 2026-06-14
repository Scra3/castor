import {expect} from 'chai'

import type {LayoutScope} from '../../../src/services/layout/types.js'

import {LayoutFileError, parseLayoutFile, serializeLayoutFile} from '../../../src/services/layout/yaml-file.js'

const scope: LayoutScope = {
  environmentId: 34,
  environmentName: 'Development',
  projectId: 12,
  projectName: 'My Project',
  serverUrl: 'http://localhost:3001',
  teamId: 56,
  teamName: 'Operations',
}

const docs = {
  folders: [{children: [{id: 'customers', isVisible: true, position: 1}], id: 'uuid-1', isMain: true}],
  layout: {collections: [{displayName: 'Clients', id: 'customers'}], dashboards: [], sections: []},
  workflows: [],
}

describe('layout/yaml-file', () => {
  it('round-trips documents and scope', () => {
    const content = serializeLayoutFile(scope, docs, () => new Date('2026-06-12T10:00:00Z'))
    const parsed = parseLayoutFile(content)

    expect(parsed.docs).to.deep.equal(docs)
    expect(parsed.scope.environmentId).to.equal(34)
    expect(parsed.scope.projectName).to.equal('My Project')
    expect(parsed.scope.teamId).to.equal(56)
    expect(parsed.scope.serverUrl).to.equal('http://localhost:3001')
  })

  it('writes the guidance header comment', () => {
    const content = serializeLayoutFile(scope, docs, () => new Date())
    expect(content).to.contain('castor layout pull')
    expect(content).to.contain('DO NOT modify them')
  })

  it('omits absent domains and parses partial files', () => {
    const content = serializeLayoutFile(scope, {layout: docs.layout}, () => new Date())
    expect(content).to.not.contain('folders:')

    const parsed = parseLayoutFile(content)
    expect(parsed.docs.folders).to.equal(undefined)
    expect(parsed.docs.layout).to.deep.equal(docs.layout)
  })

  it('rejects a file without the forest header', () => {
    expect(() => parseLayoutFile('layout: {}')).to.throw(LayoutFileError, /castor layout pull/)
  })

  it('rejects invalid YAML with a clear error', () => {
    expect(() => parseLayoutFile(':\n  - ]')).to.throw(LayoutFileError)
  })
})
