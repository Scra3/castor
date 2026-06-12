/**
 * Installs the generated agent's dependencies and starts it as a child process,
 * capturing its output for diagnostics (e.g. port-in-use detection on failure).
 */
import type {ChildProcess} from 'node:child_process'

import {appendFile, writeFile} from 'node:fs/promises'

import {CommandResult, CommandRunner, runCommand, spawnProcess} from './process-utils.js'

export type InstallOptions = {
  dir: string
  logFile?: string
  run?: CommandRunner
}

/** Run `npm install` in the generated project; mirror output to logFile if given. */
export async function installAgentDependencies(options: InstallOptions): Promise<CommandResult> {
  const run = options.run ?? runCommand
  const result = await run('npm', ['install'], {cwd: options.dir})

  if (options.logFile) {
    await writeFile(options.logFile, `${result.stdout}\n${result.stderr}\n`, 'utf8')
  }

  return result
}

export type AgentHandle = {
  /** All output captured so far. */
  getOutput: () => string
  process: ChildProcess
  /** Terminate the agent (SIGTERM) and resolve once it has exited. */
  stop: () => Promise<void>
}

export type StartAgentOptions = {
  dir: string
  logFile?: string
  onOutput?: (chunk: string) => void
}

/** Spawn `node index.js` in the generated project, streaming output. */
export function startAgent(options: StartAgentOptions): AgentHandle {
  let output = ''

  const child = spawnProcess('node', ['index.js'], {
    cwd: options.dir,
    onOutput(chunk) {
      output += chunk
      options.onOutput?.(chunk)
      if (options.logFile) appendFile(options.logFile, chunk).catch(() => {})
    },
  })

  return {
    getOutput: () => output,
    process: child,
    stop: () =>
      new Promise<void>(resolve => {
        if (child.exitCode !== null || child.killed) {
          resolve()

          return
        }

        child.once('close', () => resolve())
        child.kill('SIGTERM')
      }),
  }
}

/** True when the agent output shows the listen port is already taken. */
export function hasAddressInUse(output: string): boolean {
  return output.includes('EADDRINUSE')
}

/** Return the last `count` lines of `output` (for error diagnostics). */
export function lastLines(output: string, count: number): string {
  return output.split('\n').slice(-count).join('\n')
}
