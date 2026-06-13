import {Command, Flags} from '@oclif/core'

import {startWorkflow} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'

export default class WorkflowStart extends Command {
  static description = 'Start a workflow run on a record (orchestrator engine only).'

  static examples = [
    '<%= config.bin %> workflow start --workflow 550e8400-e29b-41d4-a716-446655440000 --collection customers --record 1',
  ]

  static flags = {
    ...workflowFlags,
    collection: Flags.string({description: 'Collection id of the target record', required: true}),
    record: Flags.string({description: 'Selected record id', required: true}),
    workflow: Flags.string({description: 'Workflow id (uuid) — see `workflow list`', required: true}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WorkflowStart)

    await withWorkflow(this, flags, async ({client, renderingId}) => {
      const run = await startWorkflow(client, renderingId, {
        collectionId: flags.collection,
        selectedRecordId: flags.record,
        workflowId: flags.workflow,
      })
      this.log('✓ Workflow run started.')
      printJson(this, run)
    })
  }
}
