import {expect} from 'chai'

import type {ForestApiClient, JsonApiDocument} from '../../src/services/api-client.js'

import {ProjectError, createProject, findDefaultEnvironmentId} from '../../src/services/project.js'

function fakeClient(doc: JsonApiDocument, secretKey: string): ForestApiClient {
  return {
    createProject: () => Promise.resolve(doc),
    getEnvironmentSecretKey: () => Promise.resolve(secretKey),
  } as unknown as ForestApiClient
}

describe('project.findDefaultEnvironmentId', () => {
  it('reads the id from the defaultEnvironment relationship', () => {
    const doc: JsonApiDocument = {
      data: {id: '7', relationships: {defaultEnvironment: {data: {id: '42', type: 'environments'}}}, type: 'projects'},
    }
    expect(findDefaultEnvironmentId(doc)).to.equal('42')
  })

  it('falls back to an included environment when no relationship', () => {
    const doc: JsonApiDocument = {
      data: {id: '7', type: 'projects'},
      included: [{attributes: {}, id: '99', type: 'environments'}],
    }
    expect(findDefaultEnvironmentId(doc)).to.equal('99')
  })

  it('throws when no environment can be found', () => {
    expect(() => findDefaultEnvironmentId({data: {id: '7', type: 'projects'}})).to.throw(ProjectError)
  })
})

describe('project.createProject', () => {
  const doc: JsonApiDocument = {
    data: {id: '7', relationships: {defaultEnvironment: {data: {id: '42', type: 'environments'}}}, type: 'projects'},
    included: [{attributes: {isActive: false, name: 'Development'}, id: '42', type: 'environments'}],
  }

  it('returns project id, environment id, name and secret', async () => {
    const result = await createProject(fakeClient(doc, 'super-secret'), 'My Project')

    expect(result).to.deep.equal({
      alreadyActive: false,
      envSecret: 'super-secret',
      environmentId: '42',
      environmentName: 'Development',
      projectId: '7',
    })
  })

  it('flags alreadyActive when the returned environment is active (name collision)', async () => {
    const activeDoc: JsonApiDocument = {
      ...doc,
      included: [{attributes: {isActive: true, name: 'Development'}, id: '42', type: 'environments'}],
    }

    const result = await createProject(fakeClient(activeDoc, 's'), 'Taken')

    expect(result.alreadyActive).to.equal(true)
  })
})
