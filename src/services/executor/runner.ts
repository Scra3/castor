/**
 * Install and run a scaffolded workflow-executor project as a child process,
 * capturing output to detect readiness ("Workflow executor ready") and fatal
 * startup failures (Node version, port in use, bad secrets). Mirrors
 * services/agent-runner.ts.
 */
import type {ChildProcess} from 'node:child_process'

import {appendFile, writeFile} from 'node:fs/promises'

import {CommandResult, CommandRunner, runCommand, spawnProcess} from '../process-utils.js'

export type InstallExecutorOptions = {
  dir: string
  logFile?: string
  run?: CommandRunner
}

/** Run `npm install` in the generated executor project; mirror output to logFile. */
export async function installExecutorDependencies(options: InstallExecutorOptions): Promise<CommandResult> {
  const run = options.run ?? runCommand
  const result = await run('npm', ['install'], {cwd: options.dir})

  if (options.logFile) {
    await writeFile(options.logFile, `${result.stdout}\n${result.stderr}\n`, 'utf8')
  }

  return result
}

export type ExecutorHandle = {
  getOutput: () => string
  process: ChildProcess
  stop: () => Promise<void>
}

export type StartExecutorOptions = {
  dir: string
  inMemory?: boolean
  logFile?: string
  onOutput?: (chunk: string) => void
}

/** Spawn the executor via its npm start script (database or in-memory), streaming output. */
export function startExecutor(options: StartExecutorOptions): ExecutorHandle {
  let output = ''

  const child = spawnProcess('npm', ['run', options.inMemory ? 'start:memory' : 'start'], {
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

/** True once the executor logs that it is up and listening. */
export function isExecutorReady(output: string): boolean {
  return output.includes('Workflow executor ready')
}

/** True when the output shows a non-recoverable startup failure. */
export function hasFatalExecutorError(output: string): boolean {
  return /requires node\.js|eaddrinuse|forest_env_secret|forest_auth_secret/i.test(output)
}

/** A clean, actionable reason for a failed startup (for ExecutorError). */
export function executorErrorReason(output: string): string {
  const nodeVersion = /(the forest workflow executor requires node\.js[^\n]*)/i.exec(output)
  if (nodeVersion) return nodeVersion[1].trim()
  if (output.includes('EADDRINUSE')) return 'The executor HTTP port is already in use — retry with --port <other>.'
  if (/forest_(env|auth)_secret/i.test(output)) {
    return 'The executor rejected its secrets — check FOREST_ENV_SECRET / FOREST_AUTH_SECRET in the executor .env.'
  }

  return 'The workflow executor failed to start (see the executor log).'
}

/** Return the last `count` lines of `output` (for diagnostics). */
export function lastLines(output: string, count: number): string {
  return output.split('\n').slice(-count).join('\n')
}

export type WaitForReadyOptions = {
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

/**
 * Poll the executor's output until it is ready, a fatal error appears, or the
 * process exits / the timeout elapses. Returns the outcome (no throw).
 */
export async function waitForExecutorReady(
  handle: {getOutput: () => string; process: {exitCode: null | number}},
  options: WaitForReadyOptions = {},
): Promise<{output: string; ready: boolean}> {
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 1000
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => {
    setTimeout(resolve, ms)
  }))
  const deadline = now() + timeoutMs

  for (;;) {
    const output = handle.getOutput()
    if (isExecutorReady(output)) return {output, ready: true}
    if (hasFatalExecutorError(output) || handle.process.exitCode !== null) return {output, ready: false}
    if (now() >= deadline) return {output, ready: false}
    // eslint-disable-next-line no-await-in-loop
    await sleep(intervalMs)
  }
}
