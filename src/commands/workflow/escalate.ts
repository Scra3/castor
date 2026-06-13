import {Args, Command, Flags} from '@oclif/core'

import {escalateWorkflow} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'

export default class WorkflowEscalate extends Command {
  static args = {
    runId: Args.integer({description: 'Workflow run id', required: true}),
  }

  static description = 'Escalate a workflow run into an inbox.'

  static examples = ['<%= config.bin %> workflow escalate 42 --inbox 550e8400-e29b-41d4-a716-446655440000']

  static flags = {
    ...workflowFlags,
    inbox: Flags.string({description: 'Inbox id (uuid)', required: true}),
  }

  async run(): Promise<void> {
    const {args, flags} = await this.parse(WorkflowEscalate)

    await withWorkflow(this, flags, async ({client, renderingId}) => {
      const result = await escalateWorkflow(client, renderingId, args.runId, flags.inbox)
      this.log(`✓ Workflow run #${args.runId} escalated.`)
      printJson(this, result)
    })
  }
}
