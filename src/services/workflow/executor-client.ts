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

/**
 * A non-2xx response from the executor. Carries the HTTP `status` and raw `body`
 * (shape `{ "error": <userMessage> }`) so callers can decide whether the failure
 * is a transient claim race (retry) or a real error (fatal).
 */
export class ExecutorHttpError extends WorkflowError {
  readonly body: string

  readonly status: number

  constructor(status: number, body: string, message: string) {
    super(message)
    this.name = 'ExecutorHttpError'
    this.status = status
    this.body = body
  }
}

/**
 * True for the executor errors that mean "no claimable step for this run *right
 * now*" — a timing race against the orchestrator's atomic claim or the executor's
 * background poll, not a real failure. Verified against the executor's `toHttpError`:
 *   - 404 RunNotFoundError ("not found or unavailable")
 *   - 503 UnavailableError (run/workflow store transient, "please retry")
 *   - 400 RunAlreadyInFlightError (body: "… is already being processed")
 * Everything else (other 400 like InvalidPendingData, 403 UserMismatch, network) is fatal.
 */
export function isTransientTriggerError(error: unknown): boolean {
  if (!(error instanceof ExecutorHttpError)) return false
  if (error.status === 404 || error.status === 503) return true

  return error.status === 400 && /already being processed|in flight/i.test(error.body)
}

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
          reject(
            new ExecutorHttpError(
              res.statusCode,
              responseBody,
              `Executor returned HTTP ${res.statusCode} for ${subpath}: ${responseBody.slice(0, 200)}`,
            ),
          )

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

export type TriggerRetryOptions = {
  baseDelayMs?: number
  maxDelayMs?: number
  /** Notified before each backoff sleep (attempt is 1-based, the retry about to happen). */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void
  /** Injectable RNG for jitter (default Math.random); kept injectable for deterministic tests. */
  random?: () => number
  /** Total attempts beyond the first (so retries:10 ⇒ up to 11 calls). */
  retries?: number
  /** Injectable sleep (default setTimeout-promise). */
  sleep?: (ms: number) => Promise<void>
  /** Predicate deciding whether an error is worth retrying (default isTransientTriggerError). */
  transient?: (error: unknown) => boolean
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms)
  })

/**
 * Run `fn`, retrying ONLY transient errors (default `isTransientTriggerError`)
 * with exponential backoff + full jitter. Rethrows a non-transient error
 * immediately, and the last transient error once attempts are exhausted. Pure
 * apart from the injected `sleep`/`random`, so it unit-tests without the network.
 */
export async function retryTransient<T>(fn: () => Promise<T>, options: TriggerRetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 10
  const baseDelayMs = options.baseDelayMs ?? 250
  const maxDelayMs = options.maxDelayMs ?? 5000
  const sleep = options.sleep ?? defaultSleep
  const random = options.random ?? Math.random
  const transient = options.transient ?? isTransientTriggerError

  for (let attempt = 0; ; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await fn()
    } catch (error) {
      if (attempt >= retries || !transient(error)) throw error

      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)
      const delayMs = Math.round(random() * ceiling)
      options.onRetry?.(attempt + 1, delayMs, error)
      // eslint-disable-next-line no-await-in-loop
      await sleep(delayMs)
    }
  }
}

/**
 * Trigger the executor, retrying transient claim races (see `isTransientTriggerError`)
 * with backoff. Defaults are sized to outlast one executor poll cycle (~30s); a
 * first-call success costs nothing.
 */
export function triggerExecutorRunWithRetry(
  params: ExecutorAccess & {pendingData?: unknown; runId: number},
  options: TriggerRetryOptions = {},
): Promise<unknown> {
  return retryTransient(() => triggerExecutorRun(params), options)
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
