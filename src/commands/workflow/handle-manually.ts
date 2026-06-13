import {Args, Command} from '@oclif/core'

import {handleWorkflowManually} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'

export default class WorkflowHandleManually extends Command {
  static args = {
    runId: Args.integer({description: 'Workflow run id', required: true}),
  }

  static description = 'Mark the current manual step of a workflow run as done.'

  static examples = ['<%= config.bin %> workflow handle-manually 42']

  static flags = {...workflowFlags}

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WorkflowHandleManually)

    await withWorkflow(this, flags, async ({client, renderingId}) => {
      const result = await handleWorkflowManually(client, renderingId, args.runId)
      this.log('✓ Manual step handled.')
      printJson(this, result)
    })
  }
}
