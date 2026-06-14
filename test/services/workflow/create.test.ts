import {expect} from 'chai'

import type {ForestApiClient} from '../../../src/services/api-client.js'
import type {LayoutScope} from '../../../src/services/layout/types.js'

import {parseWorkflowSpec} from '../../../src/services/workflow/bpmn.js'
import {createWorkflow} from '../../../src/services/workflow/create.js'

const SCOPE: LayoutScope = {
  environmentId: 174_626,
  environmentName: 'Development',
  projectId: 1,
  projectName: 'demo',
  serverUrl: 'https://api.forestadmin.com',
  teamId: 122_376,
  teamName: 'Operations',
}

const SPEC = parseWorkflowSpec(
  'name: Update email\ncollection: customers\nsteps:\n  - {id: read, type: read, auto: true, next: update}\n  - {id: update, type: update, next: done}\n  - {id: done, type: end}',
)

type Patch = {ops: Array<{op: string; path: string; value?: unknown}>}

function fakeClient(existing: unknown[] = []) {
  const patches: Patch[] = []
  const presignArgs: Array<{collectionId: string; renderingId: number; workflowId: string}> = []
  const client = {
    generateWorkflowPresignedRequest(workflowId: string, collectionId: string, renderingId: number) {
      presignArgs.push({collectionId, renderingId, workflowId})

      return Promise.resolve({fields: {key: 'k', policy: 'p'}, url: 'https://s3.example/bucket'})
    },
    getLayoutDomain: () => Promise.resolve(existing),
    patchLayoutDomain(_domain: string, ops: Patch['ops']) {
      patches.push({ops})

      return Promise.resolve()
    },
  } as unknown as ForestApiClient

  return {client, patches, presignArgs}
}

const okFetch = () => Promise.resolve(new Response(null, {headers: {'x-amz-version-id': 'VER123'}, status: 204}))
const noVersionFetch = () => Promise.resolve(new Response(null, {status: 204}))

describe('workflow/create.createWorkflow', () => {
  it('adds the shell, uploads BPMN, and links the returned version id', async () => {
    const {client, patches, presignArgs} = fakeClient()

    const result = await createWorkflow({client, fetchImpl: okFetch, renderingId: 350_497, scope: SCOPE, spec: SPEC})

    // shell add
    const add = patches[0].ops[0]
    expect(add.op).to.equal('add')
    expect(add.path).to.equal('/workflows/-')
    expect(add.value).to.include({collectionId: 'customers', isVisible: true, name: 'Update email', position: 0})
    expect((add.value as {id: string}).id).to.match(/[\da-f-]{36}/)

    // presigned called with the new id + collection + rendering
    expect(presignArgs[0]).to.include({collectionId: 'customers', renderingId: 350_497})
    expect(presignArgs[0].workflowId).to.equal((add.value as {id: string}).id)

    // link op sets bpmnAwsS3Identifier to the S3 version
    const link = patches[1].ops[0]
    expect(link.op).to.equal('replace')
    expect(link.path).to.equal(`/workflows/${(add.value as {id: string}).id}/bpmnAwsS3Identifier`)
    expect(link.value).to.equal('VER123')

    expect(result).to.include({bpmnVersion: 'VER123', collectionId: 'customers', name: 'Update email'})
  })

  it('rejects a duplicate name on the same collection', async () => {
    const {client} = fakeClient([{collectionId: 'customers', name: 'Update email'}])
    try {
      await createWorkflow({client, fetchImpl: okFetch, renderingId: 1, scope: SCOPE, spec: SPEC})
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.match(/already exists/)
    }
  })

  it('fails clearly when S3 returns no version id', async () => {
    const {client} = fakeClient()
    try {
      await createWorkflow({client, fetchImpl: noVersionFetch, renderingId: 1, scope: SCOPE, spec: SPEC})
      expect.fail('should have thrown')
    } catch (error) {
      expect((error as Error).message).to.match(/version id/)
    }
  })
})
