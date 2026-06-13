import {Args, Command} from '@oclif/core'

import {resumeWorkflow} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'

export default class WorkflowResume extends Command {
  static args = {
    runId: Args.integer({description: 'Workflow run id', required: true}),
  }

  static description = 'Resume a workflow run and print its current state.'

  static examples = ['<%= config.bin %> workflow resume 42']

  static flags = {...workflowFlags}

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WorkflowResume)

    await withWorkflow(this, flags, async ({client, renderingId}) => {
      const run = await resumeWorkflow(client, renderingId, args.runId)
      printJson(this, run)
    })
  }
}
