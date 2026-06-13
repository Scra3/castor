import {Args, Command} from '@oclif/core'

import {continueWorkflow} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'

export default class WorkflowContinue extends Command {
  static args = {
    runId: Args.integer({description: 'Workflow run id', required: true}),
  }

  static description = 'Advance a workflow run to its next step.'

  static examples = ['<%= config.bin %> workflow continue 42']

  static flags = {...workflowFlags}

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WorkflowContinue)

    await withWorkflow(this, flags, async ({client, renderingId}) => {
      const result = await continueWorkflow(client, renderingId, args.runId)
      this.log('✓ Workflow run advanced.')
      printJson(this, result)
    })
  }
}
