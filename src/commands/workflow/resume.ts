import {Args, Command, Flags} from '@oclif/core'
import {join} from 'node:path'

import {decodeForestUser} from '../../services/agent/token.js'
import {readEnvFile} from '../../services/env-file.js'
import {resumeWorkflow} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'
import {assembleRun, fetchExecutorRun} from '../../services/workflow/executor-client.js'

const DEFAULT_EXECUTOR_PORT = 3400

export default class WorkflowResume extends Command {
  static args = {
    runId: Args.integer({description: 'Workflow run id', required: true}),
  }

  static description =
    'Resume a workflow run and print its state — merged with the executor’s per-step data when reachable.'

  static examples = [
    '<%= config.bin %> workflow resume 42',
    '<%= config.bin %> workflow resume 42 --project-dir ./my-project',
  ]

  static flags = {
    ...workflowFlags,
    'executor-port': Flags.integer({default: DEFAULT_EXECUTOR_PORT, description: 'Executor HTTP port (when --project-dir is set)'}),
    'executor-url': Flags.string({description: 'Executor base URL (default: http://localhost:<executor-port>)'}),
    'project-dir': Flags.string({description: 'Agent dir — reads FOREST_AUTH_SECRET to fetch the executor’s step data'}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WorkflowResume)

    await withWorkflow(this, flags, async ({client, forestToken, renderingId}) => {
      const run = await resumeWorkflow(client, renderingId, args.runId)
      const assembled = await this.mergeExecutorData(run, args.runId, renderingId, forestToken, flags)
      printJson(this, assembled)
    })
  }

  /** Best-effort: fetch executor step data and merge it; on failure, return the orchestrator run. */
  private async mergeExecutorData(
    run: unknown,
    runId: number,
    renderingId: number,
    forestToken: string,
    flags: {'executor-port': number; 'executor-url'?: string; 'project-dir'?: string},
  ): Promise<unknown> {
    if (!flags['project-dir']) return run

    try {
      const agentEnv = await readEnvFile(join(flags['project-dir'], '.env'))
      const authSecret = agentEnv.FOREST_AUTH_SECRET
      if (!authSecret) {
        this.warn('No FOREST_AUTH_SECRET in --project-dir/.env; showing orchestrator state only.')

        return run
      }

      const user = decodeForestUser(forestToken)
      const executorData = await fetchExecutorRun({
        authSecret,
        email: user.email,
        executorUrl: flags['executor-url'] ?? `http://localhost:${flags['executor-port']}`,
        renderingId,
        runId,
        userId: user.id,
      })

      return assembleRun(run, executorData)
    } catch (error) {
      this.warn(`Executor data unavailable (${error instanceof Error ? error.message : error}); showing orchestrator state only.`)

      return run
    }
  }
}
