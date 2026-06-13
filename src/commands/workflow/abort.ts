import {Args, Command} from '@oclif/core'

import {realConfirm} from '../../services/prompts.js'
import {abortWorkflow} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'

export default class WorkflowAbort extends Command {
  static args = {
    runId: Args.integer({description: 'Workflow run id', required: true}),
  }

  static description = 'Abort (cancel) a workflow run.'

  static examples = ['<%= config.bin %> workflow abort 42', '<%= config.bin %> workflow abort 42 --yes']

  static flags = {...workflowFlags}

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WorkflowAbort)

    const interactive = !flags.yes && Boolean(process.stdout.isTTY)
    if (interactive && !(await realConfirm(`Abort workflow run #${args.runId}?`))) {
      this.log('Cancelled.')

      return
    }

    await withWorkflow(this, flags, async ({client, renderingId}) => {
      const result = await abortWorkflow(client, renderingId, args.runId)
      this.log(`✓ Workflow run #${args.runId} aborted.`)
      printJson(this, result)
    })
  }
}
