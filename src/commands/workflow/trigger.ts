import {Args, Command, Flags} from '@oclif/core'
import {join} from 'node:path'

import {decodeForestUser} from '../../services/agent/token.js'
import {readEnvFile} from '../../services/env-file.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'
import {WorkflowError} from '../../services/workflow/errors.js'
import {triggerExecutorRun} from '../../services/workflow/executor-client.js'

const DEFAULT_EXECUTOR_PORT = 3400

export default class WorkflowTrigger extends Command {
  static args = {
    runId: Args.integer({description: 'Workflow run id', required: true}),
  }

  static description = 'Trigger a workflow run on the executor now, optionally sending input data (pendingData).'

  static examples = [
    '<%= config.bin %> workflow trigger 42 --project-dir ./my-project',
    '<%= config.bin %> workflow trigger 42 --project-dir ./my-project --data \'{"amount":100}\'',
  ]

  static flags = {
    ...workflowFlags,
    data: Flags.string({description: 'Input data to inject (pendingData) as JSON'}),
    'executor-port': Flags.integer({default: DEFAULT_EXECUTOR_PORT, description: 'Executor HTTP port'}),
    'executor-url': Flags.string({description: 'Executor base URL (default: http://localhost:<executor-port>)'}),
    'project-dir': Flags.string({description: 'Agent dir — reads FOREST_AUTH_SECRET to authenticate to the executor', required: true}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WorkflowTrigger)

    await withWorkflow(this, flags, async ({forestToken, renderingId}) => {
      const pendingData = this.parsePendingData(flags.data)
      const agentEnv = await readEnvFile(join(flags['project-dir'] as string, '.env')).catch(() => {
        throw new WorkflowError(`Cannot read ${join(flags['project-dir'] as string, '.env')} — check --project-dir.`)
      })
      const authSecret = agentEnv.FOREST_AUTH_SECRET
      if (!authSecret) throw new WorkflowError('No FOREST_AUTH_SECRET in --project-dir/.env.')

      const user = decodeForestUser(forestToken)
      const result = await triggerExecutorRun({
        authSecret,
        email: user.email,
        executorUrl: flags['executor-url'] ?? `http://localhost:${flags['executor-port']}`,
        pendingData,
        renderingId,
        runId: args.runId,
        userId: user.id,
      })

      this.log(`✓ Run #${args.runId} triggered on the executor.`)
      printJson(this, result)
    })
  }

  private parsePendingData(raw: string | undefined): unknown {
    if (raw === undefined) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      throw new WorkflowError('--data must be valid JSON.')
    }
  }
}
