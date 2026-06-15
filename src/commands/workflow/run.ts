import {Command, Flags} from '@oclif/core'
import {join} from 'node:path'

import {decodeForestUser} from '../../services/agent/token.js'
import {readEnvFile} from '../../services/env-file.js'
import {driveRun} from '../../services/workflow/autopilot.js'
import {continueWorkflow, resumeWorkflow, startWorkflow} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'
import {WorkflowError} from '../../services/workflow/errors.js'
import {assembleRun, fetchExecutorRun, triggerExecutorRunWithRetry} from '../../services/workflow/executor-client.js'

const DEFAULT_EXECUTOR_PORT = 3400

type RunRecord = {id?: number | string; runState?: string; workflowHistory?: Array<{done?: boolean; stepDefinition?: {taskType?: string; type?: string}; stepIndex?: number}>}

export default class WorkflowRun extends Command {
  static description = 'Run a workflow end-to-end on a record (autopilot): start, then drive every step to finished.'

  static examples = [
    '<%= config.bin %> workflow run --workflow <uuid> --collection customers --record 1 --project-dir ./my-project',
    '<%= config.bin %> workflow run --workflow <uuid> --collection customers --record 1 --project-dir ./my-project --inputs \'{"1":{"userConfirmed":true,"value":"new@mail.com"}}\'',
  ]

  static flags = {
    ...workflowFlags,
    collection: Flags.string({description: 'Collection of the target record', required: true}),
    'executor-port': Flags.integer({default: DEFAULT_EXECUTOR_PORT, description: 'Executor HTTP port'}),
    'executor-url': Flags.string({description: 'Executor base URL (default: http://localhost:<executor-port>)'}),
    inputs: Flags.string({description: 'Per-step input patches as JSON keyed by stepIndex, e.g. \'{"1":{"userConfirmed":true,"value":"x"}}\''}),
    'project-dir': Flags.string({description: 'Agent dir — reads FOREST_AUTH_SECRET to reach the executor', required: true}),
    record: Flags.string({description: 'Selected record id', required: true}),
    'trigger-retries': Flags.integer({default: 10, description: 'Retries when the executor has no claimable step yet (transient race under parallel load)'}),
    workflow: Flags.string({description: 'Workflow id (uuid) — see `workflow list`', required: true}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WorkflowRun)
    const inputs = this.parseInputs(flags.inputs)

    await withWorkflow(this, flags, async ({client, forestToken, renderingId}) => {
      const projectDir = flags['project-dir'] as string
      const agentEnv = await readEnvFile(join(projectDir, '.env')).catch(() => {
        throw new WorkflowError(`Cannot read ${join(projectDir, '.env')} — check --project-dir.`)
      })
      const authSecret = agentEnv.FOREST_AUTH_SECRET
      if (!authSecret) throw new WorkflowError('No FOREST_AUTH_SECRET in --project-dir/.env.')

      const user = decodeForestUser(forestToken)
      const executorUrl = flags['executor-url'] ?? `http://localhost:${flags['executor-port']}`
      const access = {authSecret, email: user.email, executorUrl, renderingId, userId: user.id}

      const started = (await startWorkflow(client, renderingId, {
        collectionId: flags.collection,
        selectedRecordId: flags.record,
        workflowId: flags.workflow,
      })) as RunRecord
      const runId = Number(started.id)
      if (!Number.isFinite(runId)) throw new WorkflowError('Could not read the run id from start.')
      this.log(`▶ run ${runId} started on ${flags.collection}#${flags.record}`)

      await driveRun(
        {
          async advance() {
            await continueWorkflow(client, renderingId, runId)
          },
          log: m => this.log(`  ${m}`),
          async resume() {
            const run = (await resumeWorkflow(client, renderingId, runId)) as RunRecord
            const history = run.workflowHistory ?? []
            const last = history.at(-1)

            return {
              lastStep: last
                ? {done: Boolean(last.done), stepIndex: Number(last.stepIndex), type: last.stepDefinition?.taskType ?? last.stepDefinition?.type}
                : undefined,
              runState: String(run.runState),
            }
          },
          sleep: ms => new Promise<void>(resolve => {
            setTimeout(resolve, ms)
          }),
          async trigger(patch) {
            await triggerExecutorRunWithRetry(
              {...access, pendingData: patch, runId},
              {
                onRetry: (attempt, delayMs) =>
                  this.log(`  ⟳ step not claimable yet — retry ${attempt}/${flags['trigger-retries']} in ${delayMs}ms`),
                retries: flags['trigger-retries'],
              },
            )
          },
        },
        {inputs},
      )

      // Final assembled view (state + executor data).
      const finalRun = await resumeWorkflow(client, renderingId, runId)
      const executorData = await fetchExecutorRun({...access, runId}).catch(() => ({steps: []}))
      this.log('')
      printJson(this, assembleRun(finalRun, executorData))
    })
  }

  /** Parse --inputs (JSON object keyed by stepIndex) into a numeric-keyed map. */
  private parseInputs(raw: string | undefined): Record<number, unknown> {
    if (!raw) return {}
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      throw new WorkflowError('--inputs must be valid JSON.')
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new WorkflowError('--inputs must be a JSON object keyed by stepIndex.')
    }

    const out: Record<number, unknown> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) out[Number(key)] = value

    return out
  }
}
