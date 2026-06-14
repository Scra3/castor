/**
 * Create a runnable workflow: add the record, upload its compiled BPMN to S3, and
 * link the version. Verified sequence (forestadmin-server):
 *   1. patch `add /workflows/-` (shell, with a generated uuid)
 *   2. POST generate-presigned-request?collectionId=… → multipart POST the BPMN to S3
 *      (the upload's `x-amz-version-id` is the bpmnAwsS3Identifier)
 *   3. patch `replace /workflows/:id/bpmnAwsS3Identifier`
 */
import {Buffer} from 'node:buffer'
import {randomUUID} from 'node:crypto'

import type {ForestApiClient} from '../api-client.js'
import type {LayoutScope} from '../layout/types.js'

import {ForestApiError} from '../api-client.js'
import {fetchDomains} from '../layout/fetch.js'
import {type WorkflowSpec, compileWorkflowToBpmn} from './bpmn.js'
import {WorkflowError} from './errors.js'

type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>
type Presigned = {fields: Record<string, string>; url: string}

export type CreateWorkflowResult = {bpmnVersion: string; collectionId: string; id: string; name: string}

export type CreateWorkflowOptions = {
  client: ForestApiClient
  fetchImpl?: FetchImpl
  renderingId: number
  scope: LayoutScope
  spec: WorkflowSpec
}

/** Multipart-POST the BPMN to the presigned S3 URL; return the new object's VersionId. */
async function uploadBpmnToS3(presigned: Presigned, bpmn: string, fetchImpl: FetchImpl): Promise<string> {
  const form = new FormData()
  for (const [key, value] of Object.entries(presigned.fields)) form.append(key, value)
  form.append('file', new Blob([bpmn], {type: 'application/xml'}), 'workflow.bpmn')

  const res = await fetchImpl(presigned.url, {body: form, method: 'POST'})
  if (res.status >= 400) throw new WorkflowError(`BPMN upload to S3 failed (HTTP ${res.status}).`)

  const versionId = res.headers.get('x-amz-version-id')
  if (!versionId) throw new WorkflowError('S3 did not return a version id for the uploaded BPMN (bucket versioning off?).')

  return versionId
}

/** Create + deploy a workflow from a validated spec. Returns its id + bpmn version. */
export async function createWorkflow(options: CreateWorkflowOptions): Promise<CreateWorkflowResult> {
  const {client, fetchImpl = (input, init) => fetch(input, init), renderingId, scope, spec} = options
  const context = {environmentId: scope.environmentId, teamId: scope.teamId}

  try {
    const docs = await fetchDomains(client, scope, ['workflows'])
    const existing = (docs.workflows ?? []) as Array<{collectionId?: string; name?: string}>
    if (existing.some(w => w.collectionId === spec.collection && w.name === spec.name)) {
      throw new WorkflowError(`A workflow named "${spec.name}" already exists on "${spec.collection}".`)
    }

    const id = randomUUID()
    const {bpmn} = compileWorkflowToBpmn(spec)

    await client.patchLayoutDomain(
      'workflows',
      [{op: 'add', path: '/workflows/-', value: {collectionId: spec.collection, id, isVisible: true, name: spec.name, position: existing.length, segmentIds: spec.segments ?? []}}],
      context,
    )

    const presigned = await client.generateWorkflowPresignedRequest(id, spec.collection, renderingId, {
      name: `${id}.bpmn`,
      size: Buffer.byteLength(bpmn),
      type: 'application/xml',
    })
    const bpmnVersion = await uploadBpmnToS3(presigned, bpmn, fetchImpl)

    await client.patchLayoutDomain(
      'workflows',
      [{op: 'replace', path: `/workflows/${id}/bpmnAwsS3Identifier`, value: bpmnVersion}],
      context,
    )

    return {bpmnVersion, collectionId: spec.collection, id, name: spec.name}
  } catch (error) {
    if (error instanceof ForestApiError) throw new WorkflowError(`Workflow creation failed: ${error.detail}`)
    throw error
  }
}
