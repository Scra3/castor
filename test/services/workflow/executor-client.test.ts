import {expect} from 'chai'

import {WorkflowError} from '../../../src/services/workflow/errors.js'
import {
  ExecutorHttpError,
  assembleRun,
  isTransientTriggerError,
  retryTransient,
} from '../../../src/services/workflow/executor-client.js'

describe('workflow/executor-client.assembleRun', () => {
  const executorData = {
    steps: [
      {
        executionResult: {fields: [{name: 'email', value: 'alice@example.com'}]},
        selectedRecordRef: {collectionName: 'customers', recordId: '1'},
        stepIndex: 0,
        type: 'read-record',
      },
    ],
  }

  it('attaches executor data to the matching workflowHistory step (by stepIndex)', () => {
    const run = {id: 97_678, runState: 'started', workflowHistory: [{done: true, stepIndex: 0, stepName: 'A'}]}
    const merged = assembleRun(run, executorData) as {workflowHistory: Array<Record<string, unknown>>}

    const step = merged.workflowHistory[0]
    expect(step.stepName).to.equal('A')
    expect(step.execution).to.deep.equal({
      executionParams: undefined,
      executionResult: {fields: [{name: 'email', value: 'alice@example.com'}]},
      selectedRecordRef: {collectionName: 'customers', recordId: '1'},
    })
  })

  it('leaves history steps without executor data unchanged', () => {
    const run = {workflowHistory: [{stepIndex: 0}, {stepIndex: 9, stepName: 'no-data'}]}
    const merged = assembleRun(run, executorData) as {workflowHistory: Array<Record<string, unknown>>}

    expect(merged.workflowHistory[1]).to.deep.equal({stepIndex: 9, stepName: 'no-data'})
    expect(merged.workflowHistory[1]).to.not.have.property('execution')
  })

  it('returns the run untouched when there is no workflowHistory array', () => {
    const run = {id: 1, runState: 'finished'}
    expect(assembleRun(run, {steps: []})).to.deep.equal(run)
  })
})

describe('workflow/executor-client.isTransientTriggerError', () => {
  it('treats 404 (not found/unavailable) as transient', () => {
    expect(isTransientTriggerError(new ExecutorHttpError(404, '{"error":"Run not found or unavailable"}', 'm'))).to.equal(true)
  })

  it('treats 503 (store/port unavailable) as transient', () => {
    expect(isTransientTriggerError(new ExecutorHttpError(503, '{"error":"please retry"}', 'm'))).to.equal(true)
  })

  it('treats 400 "already being processed" as transient', () => {
    expect(isTransientTriggerError(new ExecutorHttpError(400, '{"error":"Run \\"5\\" is already being processed"}', 'm'))).to.equal(true)
  })

  it('treats a plain 400 (invalid request body) as fatal', () => {
    expect(isTransientTriggerError(new ExecutorHttpError(400, '{"error":"The request body is invalid."}', 'm'))).to.equal(false)
  })

  it('treats 403 (user mismatch) as fatal', () => {
    expect(isTransientTriggerError(new ExecutorHttpError(403, '{"error":"Forbidden"}', 'm'))).to.equal(false)
  })

  it('treats a non-HTTP error (network) as fatal', () => {
    expect(isTransientTriggerError(new WorkflowError('executor unreachable'))).to.equal(false)
  })
})

const noSleep = async (): Promise<void> => {}
const transientError = (): ExecutorHttpError => new ExecutorHttpError(404, '{"error":"unavailable"}', 'transient')

describe('workflow/executor-client.retryTransient', () => {
  it('retries transient failures then resolves, with growing backoff delays', async () => {
    let calls = 0
    const delays: number[] = []
    const result = await retryTransient(
      async () => {
        calls++
        if (calls < 4) throw transientError()
        return 'ok'
      },
      {baseDelayMs: 100, maxDelayMs: 10_000, onRetry: (_a, ms) => delays.push(ms), random: () => 1, sleep: noSleep},
    )

    expect(result).to.equal('ok')
    expect(calls).to.equal(4)
    // full jitter at random()=1 → exactly the ceiling: 100, 200, 400
    expect(delays).to.deep.equal([100, 200, 400])
  })

  it('rethrows a fatal error immediately without sleeping', async () => {
    let calls = 0
    let slept = false
    const recordingSleep = async (): Promise<void> => {
      slept = true
    }

    const error = await retryTransient(
      async () => {
        calls++
        throw new ExecutorHttpError(400, '{"error":"The request body is invalid."}', 'fatal')
      },
      {sleep: recordingSleep},
    ).catch((error_: unknown) => error_)

    expect(calls).to.equal(1)
    expect(slept).to.equal(false)
    expect((error as ExecutorHttpError).status).to.equal(400)
  })

  it('rethrows the last transient error after exhausting retries', async () => {
    let calls = 0
    const error = await retryTransient(
      async () => {
        calls++
        throw transientError()
      },
      {random: () => 0, retries: 2, sleep: noSleep},
    ).catch((error_: unknown) => error_)

    expect(calls).to.equal(3) // 1 initial + 2 retries
    expect((error as ExecutorHttpError).status).to.equal(404)
  })
})
