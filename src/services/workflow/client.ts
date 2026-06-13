/**
 * Typed wrappers over the Forest workflow engine orchestrator API
 * (`/api/workflow-orchestrator/*`). The server returns the run object directly
 * (verified live: top-level `id`/`runState`/`workflowHistory`/…), but older
 * builds wrapped it in `{ status, response }` — so we unwrap `.response` when
 * present and otherwise return the body as-is.
 */
import type {ForestApiClient} from '../api-client.js'

import {ForestApiError} from '../api-client.js'
import {WorkflowError} from './errors.js'

type WorkflowCaller = Pick<ForestApiClient, 'workflowOrchestratorRequest'>

async function call<T>(
  client: WorkflowCaller,
  method: string,
  subpath: string,
  renderingId: number,
  body?: unknown,
): Promise<T> {
  const result = await client.workflowOrchestratorRequest<T>(method, subpath, {body, renderingId})

  if (result && typeof result === 'object' && 'response' in result) {
    return (result as {response: T}).response
  }

  return result
}

/** POST /start — begin a workflow run on a record. */
export function startWorkflow(
  client: WorkflowCaller,
  renderingId: number,
  input: {collectionId: string; selectedRecordId: string; workflowId: string},
): Promise<unknown> {
  return call(client, 'POST', '/start', renderingId, input)
}

/** GET /resume/:runId — fetch (and resume) the run's current state. */
export function resumeWorkflow(client: WorkflowCaller, renderingId: number, runId: number): Promise<unknown> {
  return call(client, 'GET', `/resume/${runId}`, renderingId)
}

/** POST /continue/:runId — advance the run to its next step. */
export function continueWorkflow(client: WorkflowCaller, renderingId: number, runId: number): Promise<unknown> {
  return call(client, 'POST', `/continue/${runId}`, renderingId)
}

/** POST /handle-manually/:runId — mark the current (manual) step as done. */
export function handleWorkflowManually(client: WorkflowCaller, renderingId: number, runId: number): Promise<unknown> {
  return call(client, 'POST', `/handle-manually/${runId}`, renderingId)
}

/** POST /revise — roll the run back to a previous step. */
export function reviseWorkflow(
  client: WorkflowCaller,
  renderingId: number,
  input: {runId: number; stepIndex: number},
): Promise<unknown> {
  return call(client, 'POST', '/revise', renderingId, input)
}

/** POST /abort/:runId — cancel the run. */
export function abortWorkflow(client: WorkflowCaller, renderingId: number, runId: number): Promise<unknown> {
  return call(client, 'POST', `/abort/${runId}`, renderingId)
}

/** POST /escalate/:runId — escalate the run into an inbox. */
export function escalateWorkflow(
  client: WorkflowCaller,
  renderingId: number,
  runId: number,
  inboxId: string,
): Promise<unknown> {
  return call(client, 'POST', `/escalate/${runId}`, renderingId, {inboxId})
}

/** Translate an orchestrator HTTP failure into an actionable WorkflowError. */
export function mapWorkflowError(error: unknown): WorkflowError | unknown {
  if (!(error instanceof ForestApiError)) return error

  if (error.status === 403) {
    return new WorkflowError(
      `Access denied by the orchestrator (403). ${error.detail} ` +
        'Check that this environment uses the orchestrator engine and that you have access to the rendering.',
    )
  }

  if (error.status === 404) return new WorkflowError(`Not found (404): unknown run or workflow. ${error.detail}`)

  return new WorkflowError(`Workflow orchestrator error (HTTP ${error.status}): ${error.detail}`)
}
