import {expect} from 'chai'

import type {ForestApiClient} from '../../../src/services/api-client.js'

import {ForestApiError} from '../../../src/services/api-client.js'
import {
  abortWorkflow,
  escalateWorkflow,
  mapWorkflowError,
  resumeWorkflow,
  reviseWorkflow,
  startWorkflow,
} from '../../../src/services/workflow/client.js'
import {WorkflowError} from '../../../src/services/workflow/errors.js'

type Call = {body?: unknown; method: string; renderingId: number; subpath: string}

function fakeClient(response: unknown): {calls: Call[]; client: ForestApiClient} {
  const calls: Call[] = []
  const client = {
    workflowOrchestratorRequest(method: string, subpath: string, ctx: {body?: unknown; renderingId: number}) {
      calls.push({body: ctx.body, method, renderingId: ctx.renderingId, subpath})

      return Promise.resolve({response, status: 'SUCCESS'})
    },
  } as unknown as ForestApiClient

  return {calls, client}
}

describe('workflow/client wrappers', () => {
  it('start POSTs /start with the body and unwraps .response', async () => {
    const {calls, client} = fakeClient({id: 7, runState: 'started'})
    const run = await startWorkflow(client, 350_497, {collectionId: 'customers', selectedRecordId: '1', workflowId: 'wf-1'})

    expect(run).to.deep.equal({id: 7, runState: 'started'})
    expect(calls[0]).to.deep.equal({
      body: {collectionId: 'customers', selectedRecordId: '1', workflowId: 'wf-1'},
      method: 'POST',
      renderingId: 350_497,
      subpath: '/start',
    })
  })

  it('resume GETs /resume/:runId with no body', async () => {
    const {calls, client} = fakeClient({id: 42})
    await resumeWorkflow(client, 1, 42)
    expect(calls[0]).to.deep.equal({body: undefined, method: 'GET', renderingId: 1, subpath: '/resume/42'})
  })

  it('revise POSTs /revise with {runId, stepIndex}', async () => {
    const {calls, client} = fakeClient(null)
    await reviseWorkflow(client, 1, {runId: 42, stepIndex: 2})
    expect(calls[0].subpath).to.equal('/revise')
    expect(calls[0].body).to.deep.equal({runId: 42, stepIndex: 2})
  })

  it('abort POSTs /abort/:runId', async () => {
    const {calls, client} = fakeClient(null)
    await abortWorkflow(client, 1, 42)
    expect(calls[0]).to.include({method: 'POST', subpath: '/abort/42'})
  })

  it('escalate POSTs /escalate/:runId with {inboxId}', async () => {
    const {calls, client} = fakeClient({})
    await escalateWorkflow(client, 1, 42, 'inbox-uuid')
    expect(calls[0].subpath).to.equal('/escalate/42')
    expect(calls[0].body).to.deep.equal({inboxId: 'inbox-uuid'})
  })
})

describe('workflow/client.mapWorkflowError', () => {
  it('maps 403 to an orchestrator/access hint', () => {
    const mapped = mapWorkflowError(new ForestApiError(403, 'forbidden'))
    expect(mapped).to.be.instanceOf(WorkflowError)
    expect((mapped as WorkflowError).message).to.match(/orchestrator|access/i)
  })

  it('maps 404 to a not-found message', () => {
    const mapped = mapWorkflowError(new ForestApiError(404, 'nope'))
    expect((mapped as WorkflowError).message).to.contain('Not found')
  })

  it('passes through non-ForestApiError values unchanged', () => {
    const original = new Error('boom')
    expect(mapWorkflowError(original)).to.equal(original)
  })
})
