import {expect} from 'chai'
import {readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {CommandResult} from '../../src/services/process-utils.js'

import {hasAddressInUse, installAgentDependencies, lastLines} from '../../src/services/agent-runner.js'

const okRun = async (): Promise<CommandResult> => ({code: 0, stderr: '', stdout: 'added 100 packages'})
const failRun = async (): Promise<CommandResult> => ({code: 1, stderr: 'npm ERR! boom', stdout: ''})

describe('agent-runner.installAgentDependencies', () => {
  let logFile: string

  beforeEach(() => {
    logFile = join(tmpdir(), `castor-install-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
  })

  afterEach(async () => {
    await rm(logFile, {force: true})
  })

  it('runs `npm install` in the project directory', async () => {
    const calls: Array<{args: string[]; command: string; cwd?: string}> = []
    const run = async (command: string, args: string[], options?: {cwd?: string}): Promise<CommandResult> => {
      calls.push({args, command, cwd: options?.cwd})

      return {code: 0, stderr: '', stdout: 'added 100 packages'}
    }

    const result = await installAgentDependencies({dir: '/tmp/my-agent', run})

    expect(result.code).to.equal(0)
    expect(calls[0]).to.deep.equal({args: ['install'], command: 'npm', cwd: '/tmp/my-agent'})
  })

  it('writes install output to the log file', async () => {
    await installAgentDependencies({dir: '/tmp/my-agent', logFile, run: okRun})

    expect(await readFile(logFile, 'utf8')).to.contain('added 100 packages')
  })

  it('reports a non-zero exit code without throwing', async () => {
    const result = await installAgentDependencies({dir: '/tmp/my-agent', run: failRun})

    expect(result.code).to.equal(1)
  })
})

describe('agent-runner.hasAddressInUse', () => {
  it('detects an EADDRINUSE error in the output', () => {
    expect(hasAddressInUse('Error: listen EADDRINUSE: address already in use :::3310')).to.equal(true)
    expect(hasAddressInUse('Forest Admin agent started')).to.equal(false)
  })
})

describe('agent-runner.lastLines', () => {
  it('returns the last N lines', () => {
    expect(lastLines('a\nb\nc\nd', 2)).to.equal('c\nd')
  })
})
