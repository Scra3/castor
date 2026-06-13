import {Command, Flags} from '@oclif/core'

import {reviseWorkflow} from '../../services/workflow/client.js'
import {printJson, withWorkflow, workflowFlags} from '../../services/workflow/command.js'

export default class WorkflowRevise extends Command {
  static description = 'Roll a workflow run back to a previous step.'

  static examples = ['<%= config.bin %> workflow revise --run 42 --step 1']

  static flags = {
    ...workflowFlags,
    run: Flags.integer({description: 'Workflow run id', required: true}),
    step: Flags.integer({description: 'Step index to revert to (0-based)', required: true}),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(WorkflowRevise)

    await withWorkflow(this, flags, async ({client, renderingId}) => {
      const result = await reviseWorkflow(client, renderingId, {runId: flags.run, stepIndex: flags.step})
      this.log('✓ Step revised. Resume the run to see its new state.')
      printJson(this, result)
    })
  }
}
