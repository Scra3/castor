/**
 * Autopilot: drive a workflow run from start to `finished` by reacting to its
 * state, so callers don't hand-orchestrate trigger/continue/confirm.
 *
 * The decision logic is here and depends only on injectable ops (resume/advance/
 * trigger/sleep/log), so it is unit-testable without network. Per step:
 *   - last step done            → `advance` (continue to the next step)
 *   - step not yet run          → `trigger` (run it; reads finish, inputs go awaiting)
 *   - step ran, still not done  → `trigger(patch)` (supply input / confirm, §4)
 * matching the documented drive loop (docs/WORKFLOWS.md).
 */
import {WorkflowError} from './errors.js'

export type RunStepView = {done: boolean; stepIndex: number; type?: string}
export type RunView = {lastStep?: RunStepView; runState: string}

export type DriveOps = {
  /** continue: advance the orchestrator to the next step. */
  advance: () => Promise<void>
  log: (message: string) => void
  /** read-only snapshot of the run (orchestrator). */
  resume: () => Promise<RunView>
  sleep: (ms: number) => Promise<void>
  /** trigger the executor; with a patch on the second call to supply input. */
  trigger: (patch?: unknown) => Promise<void>
}

export type DriveOptions = {
  /** Patch used for an input step with no explicit entry (accept the suggestion). */
  defaultPatch?: unknown
  /** Per-stepIndex input patches (the §4 pendingData shapes). */
  inputs?: Record<number, unknown>
  intervalMs?: number
  maxIterations?: number
}

const TERMINAL = new Set(['aborted', 'finished'])

/** Drive the run to completion; returns the final state. Throws on stall/timeout. */
export async function driveRun(ops: DriveOps, options: DriveOptions = {}): Promise<{iterations: number; runState: string}> {
  const inputs = options.inputs ?? {}
  const defaultPatch = options.defaultPatch ?? {userConfirmed: true}
  const intervalMs = options.intervalMs ?? 1500
  const maxIterations = options.maxIterations ?? 60

  const triggered = new Set<number>()
  const patched = new Set<number>()

  for (let i = 0; i < maxIterations; i++) {
    // eslint-disable-next-line no-await-in-loop
    const {lastStep, runState} = await ops.resume()
    if (TERMINAL.has(runState)) {
      ops.log(`✓ run ${runState} (${i} iteration${i === 1 ? '' : 's'}).`)

      return {iterations: i, runState}
    }

    if (!lastStep) {
      // eslint-disable-next-line no-await-in-loop
      await ops.trigger()
      // eslint-disable-next-line no-await-in-loop
      await ops.sleep(intervalMs)
      continue
    }

    if (lastStep.done) {
      // eslint-disable-next-line no-await-in-loop
      await ops.advance()
      // eslint-disable-next-line no-await-in-loop
      await ops.sleep(intervalMs)
      continue
    }

    const {stepIndex} = lastStep
    if (triggered.has(stepIndex)) {
      if (patched.has(stepIndex)) {
        throw new WorkflowError(
          `Step ${stepIndex} is still not done after input — provide a valid --inputs entry for step ${stepIndex}.`,
        )
      }

      patched.add(stepIndex)
      const patch = stepIndex in inputs ? inputs[stepIndex] : defaultPatch
      ops.log(`✎ step ${stepIndex} — supplying input ${JSON.stringify(patch)}`)
      // eslint-disable-next-line no-await-in-loop
      await ops.trigger(patch)
    } else {
      triggered.add(stepIndex)
      ops.log(`▶ step ${stepIndex}${lastStep.type ? ` (${lastStep.type})` : ''} — running`)
      // eslint-disable-next-line no-await-in-loop
      await ops.trigger()
    }

    // eslint-disable-next-line no-await-in-loop
    await ops.sleep(intervalMs)
  }

  throw new WorkflowError(`Workflow did not finish within ${maxIterations} iterations (possible loop or stuck step).`)
}
