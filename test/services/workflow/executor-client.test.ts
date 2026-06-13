import {expect} from 'chai'

import {assembleRun} from '../../../src/services/workflow/executor-client.js'

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
