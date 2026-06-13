import {expect} from 'chai'

import type {CommandResult} from '../../../src/services/process-utils.js'

import {
  executorErrorReason,
  hasFatalExecutorError,
  installExecutorDependencies,
  isExecutorReady,
  waitForExecutorReady,
} from '../../../src/services/executor/runner.js'

describe('executor/runner.installExecutorDependencies', () => {
  it('runs `npm install` in the executor directory', async () => {
    const calls: Array<{args: string[]; command: string; cwd?: string}> = []
    const run = (command: string, args: string[], options?: {cwd?: string}): Promise<CommandResult> => {
      calls.push({args, command, cwd: options?.cwd})

      return Promise.resolve({code: 0, stderr: '', stdout: 'added 200 packages'})
    }

    const result = await installExecutorDependencies({dir: '/tmp/exec', run})

    expect(result.code).to.equal(0)
    expect(calls[0]).to.deep.equal({args: ['install'], command: 'npm', cwd: '/tmp/exec'})
  })
})

describe('executor/runner output predicates', () => {
  it('detects readiness from the executor log', () => {
    expect(isExecutorReady('… Workflow executor ready {url: …}')).to.equal(true)
    expect(isExecutorReady('still booting')).to.equal(false)
  })

  it('flags fatal Node-version / port / secret failures', () => {
    expect(hasFatalExecutorError('The Forest workflow executor requires Node.js 22.12.0 or higher')).to.equal(true)
    expect(hasFatalExecutorError('Error: listen EADDRINUSE :::3400')).to.equal(true)
    expect(hasFatalExecutorError('FOREST_ENV_SECRET is invalid')).to.equal(true)
    expect(hasFatalExecutorError('Workflow executor ready')).to.equal(false)
  })

  it('extracts an actionable reason', () => {
    expect(executorErrorReason('x\nThe Forest workflow executor requires Node.js 22.12.0 or higher, but …\ny'))
      .to.contain('requires Node.js 22.12.0')
    expect(executorErrorReason('listen EADDRINUSE :::3400')).to.contain('port is already in use')
    expect(executorErrorReason('FOREST_AUTH_SECRET missing')).to.contain('secrets')
  })
})

describe('executor/runner.waitForExecutorReady', () => {
  const instant = {now: () => 0, sleep: () => Promise.resolve()}

  it('resolves ready once the log shows it', async () => {
    let output = ''
    const tick = ['booting', 'booting', 'Workflow executor ready']
    let i = 0
    const handle = {
      getOutput() {
        output = tick[Math.min(i++, tick.length - 1)]

        return output
      },
      process: {exitCode: null} as {exitCode: null | number},
    }

    const result = await waitForExecutorReady(handle, {...instant, intervalMs: 1})
    expect(result.ready).to.equal(true)
  })

  it('resolves not-ready on a fatal error', async () => {
    const handle = {getOutput: () => 'requires Node.js 22.12.0', process: {exitCode: null as null | number}}
    const result = await waitForExecutorReady(handle, instant)
    expect(result.ready).to.equal(false)
  })

  it('resolves not-ready when the process has exited', async () => {
    const handle = {getOutput: () => 'crashed', process: {exitCode: 1 as null | number}}
    const result = await waitForExecutorReady(handle, instant)
    expect(result.ready).to.equal(false)
  })
})
