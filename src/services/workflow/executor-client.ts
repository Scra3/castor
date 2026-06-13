/**
 * Read per-step execution DATA from the running workflow executor and merge it
 * into the orchestrator's run STATE.
 *
 * The orchestrator (`resume`) returns the run + `workflowHistory` (step
 * definitions, done flags, status). The executor stores what each step actually
 * did (`executionParams`/`executionResult`/`selectedRecordRef`) and exposes it on
 * `GET /runs/:runId` (Bearer JWT signed with the agent's FOREST_AUTH_SECRET).
 * `assembleRun` stitches the two together by `stepIndex`.
 *
 * Uses node:http (the executor's koa server rejects non-curl clients like the
 * native fetch — same quirk as the agent).
 */
import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'

import {mintAgentToken} from '../agent/token.js'
import {WorkflowError} from './errors.js'

export type ExecutorStep = {
  executionParams?: unknown
  executionResult?: unknown
  selectedRecordRef?: unknown
  stepIndex: number
  type?: string
}

export type ExecutorRunData = {steps: ExecutorStep[]}

/** Normalize an executor base URL to its root (no trailing slash). */
function toExecutorRoot(rawUrl: string): string {
  return rawUrl.replace(/\/+$/, '')
}

export type ExecutorAccess = {
  authSecret: string
  email?: string
  executorUrl: string
  renderingId: number
  userId?: number
}

/** Issue an authenticated node:http request to the executor (koa rejects native fetch). */
function executorRequest<T>(access: ExecutorAccess, method: string, subpath: string, body?: unknown): Promise<T> {
  const token = mintAgentToken(access.authSecret, {email: access.email, id: access.userId, renderingId: access.renderingId})
  const url = new URL(`${toExecutorRoot(access.executorUrl)}${subpath}`)
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  const payload = body === undefined ? undefined : JSON.stringify(body)

  return new Promise<T>((resolve, reject) => {
    const headers: Record<string, string> = {Authorization: `Bearer ${token}`}
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = String(Buffer.byteLength(payload))
    }

    const req = request(url, {headers, method}, res => {
      let responseBody = ''
      res.on('data', chunk => {
        responseBody += chunk
      })
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new WorkflowError(`Executor returned HTTP ${res.statusCode} for ${subpath}: ${responseBody.slice(0, 200)}`))

          return
        }

        try {
          resolve(JSON.parse(responseBody) as T)
        } catch {
          reject(new WorkflowError('Could not parse the executor response.'))
        }
      })
    })
    req.on('error', () => reject(new WorkflowError(`Workflow executor unreachable at ${access.executorUrl}. Is it running?`)))
    if (payload !== undefined) req.write(payload)
    req.end()
  })
}

/** GET <executorUrl>/runs/:runId — per-step execution data. */
export function fetchExecutorRun(params: ExecutorAccess & {runId: number}): Promise<ExecutorRunData> {
  return executorRequest<ExecutorRunData>(params, 'GET', `/runs/${params.runId}`)
}

/** POST <executorUrl>/runs/:runId/trigger — process the run now, optionally injecting pendingData. */
export function triggerExecutorRun(params: ExecutorAccess & {pendingData?: unknown; runId: number}): Promise<unknown> {
  return executorRequest(params, 'POST', `/runs/${params.runId}/trigger`, {pendingData: params.pendingData})
}

/**
 * Merge the executor's per-step data into the orchestrator run's
 * `workflowHistory`, matching by `stepIndex`. Each history entry gains an
 * `execution` field; entries with no executor data are left unchanged. Pure.
 */
export function assembleRun(run: unknown, executorData: ExecutorRunData): unknown {
  if (!run || typeof run !== 'object') return run
  const record = run as Record<string, unknown>
  const history = record.workflowHistory
  if (!Array.isArray(history)) return run

  const byIndex = new Map(executorData.steps.map(step => [step.stepIndex, step]))

  const workflowHistory = history.map(entry => {
    const index = (entry as {stepIndex?: number}).stepIndex
    const step = typeof index === 'number' ? byIndex.get(index) : undefined
    if (!step) return entry

    return {
      ...(entry as Record<string, unknown>),
      execution: {
        executionParams: step.executionParams,
        executionResult: step.executionResult,
        selectedRecordRef: step.selectedRecordRef,
      },
    }
  })

  return {...record, workflowHistory}
}
