import {expect} from 'chai'

import type {RunView} from '../../../src/services/workflow/autopilot.js'

import {driveRun} from '../../../src/services/workflow/autopilot.js'
import {WorkflowError} from '../../../src/services/workflow/errors.js'

/** Build ops over a scripted sequence of run views; record the actions taken. */
function harness(views: RunView[]) {
  const actions: string[] = []
  let i = 0
  const ops = {
    advance() {
      actions.push('advance')

      return Promise.resolve()
    },
    log() {},
    resume() {
      return Promise.resolve(views[Math.min(i++, views.length - 1)])
    },
    sleep: () => Promise.resolve(),
    trigger(patch?: unknown) {
      actions.push(patch === undefined ? 'trigger' : `trigger:${JSON.stringify(patch)}`)

      return Promise.resolve()
    },
  }

  return {actions, ops}
}

describe('workflow/autopilot.driveRun', () => {
  it('drives read → update → finished (trigger, advance, trigger, confirm)', async () => {
    // step0 not done → trigger (read); step0 done → advance; step1 not done → trigger
    // (first call); step1 still not done → trigger(input); then finished.
    const {actions, ops} = harness([
      {lastStep: {done: false, stepIndex: 0, type: 'get-data'}, runState: 'started'},
      {lastStep: {done: true, stepIndex: 0, type: 'get-data'}, runState: 'started'},
      {lastStep: {done: false, stepIndex: 1, type: 'update-data'}, runState: 'pending'},
      {lastStep: {done: false, stepIndex: 1, type: 'update-data'}, runState: 'pending'},
      {lastStep: {done: true, stepIndex: 1, type: 'update-data'}, runState: 'started'},
      {runState: 'finished'},
    ])

    const result = await driveRun(ops, {inputs: {1: {userConfirmed: true, value: 'x'}}})

    expect(result.runState).to.equal('finished')
    expect(actions).to.deep.equal([
      'trigger', // run step 0
      'advance', // step 0 done → next
      'trigger', // step 1 first call
      'trigger:{"userConfirmed":true,"value":"x"}', // step 1 input
      'advance', // step 1 done → next
    ])
  })

  it('uses the default confirm patch when no input is given for a step', async () => {
    const {actions, ops} = harness([
      {lastStep: {done: false, stepIndex: 0, type: 'update-data'}, runState: 'pending'},
      {lastStep: {done: false, stepIndex: 0, type: 'update-data'}, runState: 'pending'},
      {runState: 'finished'},
    ])

    await driveRun(ops, {})
    expect(actions).to.deep.equal(['trigger', 'trigger:{"userConfirmed":true}'])
  })

  it('throws when a step never completes after input', async () => {
    const stuck: RunView = {lastStep: {done: false, stepIndex: 0}, runState: 'pending'}
    const {ops} = harness([stuck])
    try {
      await driveRun(ops, {maxIterations: 10})
      expect.fail('should have thrown')
    } catch (error) {
      expect(error).to.be.instanceOf(WorkflowError)
    }
  })

  it('returns immediately when already finished', async () => {
    const {actions, ops} = harness([{runState: 'finished'}])
    const result = await driveRun(ops, {})
    expect(result.runState).to.equal('finished')
    expect(actions).to.deep.equal([])
  })
})
