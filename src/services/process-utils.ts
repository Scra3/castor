/**
 * Small wrappers around child_process used to shell out to npm / docker / node.
 * Always spawned with `shell: false` (args as an array) to avoid shell injection.
 */
import type {ChildProcess} from 'node:child_process'

import {spawn} from 'node:child_process'

export type CommandResult = {
  code: null | number
  stderr: string
  stdout: string
}

/** A function that runs a command to completion; injectable for tests. */
export type CommandRunner = (command: string, args: string[], options?: {cwd?: string}) => Promise<CommandResult>

/**
 * Run a command to completion, capturing stdout/stderr. Rejects only when the
 * binary cannot be spawned at all (e.g. ENOENT); a non-zero exit is reported via
 * `code` so callers can produce their own message.
 */
export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: options.cwd, shell: false})
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', chunk => {
      stdout += chunk
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('close', code => resolve({code, stderr, stdout}))
  })

/**
 * Spawn a long-running process (e.g. the agent), streaming its combined output
 * to `onOutput`. Returns the ChildProcess so the caller can kill it.
 */
export function spawnProcess(
  command: string,
  args: string[],
  options: {cwd?: string; onOutput?: (chunk: string) => void} = {},
): ChildProcess {
  const child = spawn(command, args, {cwd: options.cwd, shell: false})

  if (options.onOutput) {
    child.stdout?.on('data', chunk => options.onOutput?.(String(chunk)))
    child.stderr?.on('data', chunk => options.onOutput?.(String(chunk)))
  }

  return child
}
