import {expect} from 'chai'

import type {ForestApiClient} from '../../../src/services/api-client.js'
import type {LayoutScope} from '../../../src/services/layout/types.js'

import {assertOrchestratorEngine, resolveRenderingId} from '../../../src/services/workflow/command.js'
import {WorkflowError} from '../../../src/services/workflow/errors.js'

const SCOPE: LayoutScope = {
  environmentId: 174_626,
  environmentName: 'Development',
  projectId: 1,
  projectName: 'demo',
  serverUrl: 'https://api.forestadmin.com',
  teamId: 1,
  teamName: 'Operations',
}

describe('workflow/command.assertOrchestratorEngine', () => {
  it('throws WorkflowError when the engine is "browser"', async () => {
    const client = {getEnvironmentWorkflowEngine: () => Promise.resolve('browser')} as unknown as ForestApiClient
    try {
      await assertOrchestratorEngine(client, SCOPE.environmentId)
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(WorkflowError)
      expect((error as WorkflowError).message).to.contain('browser')
    }
  })

  it('resolves when the engine is "orchestrator"', async () => {
    const client = {getEnvironmentWorkflowEngine: () => Promise.resolve('orchestrator')} as unknown as ForestApiClient
    await assertOrchestratorEngine(client, SCOPE.environmentId) // should not throw
  })
})

describe('workflow/command.resolveRenderingId', () => {
  it('reads the rendering id from getRendering().data.id', async () => {
    const client = {getRendering: () => Promise.resolve({data: {id: '350497'}})} as unknown as ForestApiClient
    expect(await resolveRenderingId(client, SCOPE)).to.equal(350_497)
  })

  it('throws WorkflowError when the rendering id is not numeric', async () => {
    const client = {getRendering: () => Promise.resolve({data: {id: 'nope'}})} as unknown as ForestApiClient
    try {
      await resolveRenderingId(client, SCOPE)
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(WorkflowError)
    }
  })
})
